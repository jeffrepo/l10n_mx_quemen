# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
import base64
import io
import xlsxwriter
import logging
from datetime import datetime, timedelta
import pytz 

_logger = logging.getLogger(__name__)

class QuemenSummaryMovementsWizard(models.TransientModel):
    _name = 'quemen.summary.movements.wizard'
    _description = 'Resumen de movimientos en Excel'

    start_date = fields.Date(string="Fecha de inicio")
    end_date = fields.Date(string="Fecha final")
    stock_picking_type_ids = fields.Many2many("stock.picking.type", string="Tipo de movimiento")
    file_ex = fields.Binary("Archivo generado")
    file_name = fields.Char("Nombre del archivo")

    def generate_excel(self):
        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {'in_memory': True})
        sheet = workbook.add_worksheet("Movimientos")

        title_format = workbook.add_format({
            'bold': True, 'align': 'center', 'font_size': 14
        })
        header_format = workbook.add_format({
            'bold': True, 'align': 'center', 'bg_color': '#D9D9D9',
            'border': 1
        })
        cell_format = workbook.add_format({
            'align': 'center',
            'border': 1
        })
        money_format = workbook.add_format({
            'align': 'center', 'border': 1, 'num_format': '#,##0.00'
        })

        # --- SOLUCIÓN ROBUSTA DE ZONA HORARIA ---
        
        # 1. Obtener la zona horaria del usuario (o UTC por defecto)
        tz_name = self.env.context.get('tz') or 'UTC'
        user_tz = pytz.timezone(tz_name)
        utc_tz = pytz.utc
        
        # 2. Definir los límites del rango en el tiempo local (user_tz)
        
        # Límite Inferior (Start Date 00:00:00)
        start_date_obj = fields.Date.from_string(self.start_date)
        start_dt_local = user_tz.localize(datetime.combine(start_date_obj, datetime.min.time()))
        
        # Límite Superior (End Date 00:00:00 del día siguiente)
        end_date_obj = fields.Date.from_string(self.end_date)
        date_limit_obj = end_date_obj + timedelta(days=1)
        date_limit_dt_local = user_tz.localize(datetime.combine(date_limit_obj, datetime.min.time()))

        # 3. Convertir los límites locales a UTC para el search de Odoo
        # Usamos fields.Datetime.to_string() para aplicar el formato correcto de Odoo
        
        # Convertir a UTC (datetime object)
        start_dt_utc = start_dt_local.astimezone(utc_tz)
        date_limit_dt_utc = date_limit_dt_local.astimezone(utc_tz)

        # Convertir a string de Odoo
        start_datetime_utc = fields.Datetime.to_string(start_dt_utc)
        date_limit_datetime_utc = fields.Datetime.to_string(date_limit_dt_utc)

        # --- FIN SOLUCIÓN ROBUSTA ---

        _logger.info("Fecha de inicio UTC para la búsqueda: %s", start_datetime_utc)
        _logger.info("Fecha límite UTC para la búsqueda: %s", date_limit_datetime_utc)

        stock_picking_ids = self.env['stock.picking'].search([
            ('picking_type_id', 'in', self.stock_picking_type_ids.ids),
            ('date_done', '>=', start_datetime_utc), 
            ('date_done', '<', date_limit_datetime_utc), 
            ('state', '=', 'done')
        ])

        print(f"Stock picking ids {stock_picking_ids} \n")
        # ======== ENCABEZADOS ========
        sheet.merge_range(0, 0, 0, 7, self.env.company.name or "", title_format)
        sheet.merge_range(1, 0, 1, 7, "Salida por donaciones", title_format)

        sheet.write(2, 0, f"Del {self.start_date.strftime('%d/%m/%Y')} al {self.end_date.strftime('%d/%m/%Y')}")

        # ======== TITULOS DE COLUMNAS ========
        sheet.merge_range(5, 2, 5, 3, "PRODUCTO TERMINADO", header_format)
        sheet.merge_range(5, 4, 5, 5, "MATERIAL DE VENTA", header_format)
        sheet.merge_range(5, 6, 5, 7, "TOTAL ENTRADAS", header_format)

        sheet.write(6, 0, "No.", header_format)
        sheet.write(6, 1, "Sucursal", header_format)
        sheet.write(6, 2, "Piezas", header_format)
        sheet.write(6, 3, "Importe", header_format)
        sheet.write(6, 4, "Piezas", header_format)
        sheet.write(6, 5, "Importe", header_format)
        sheet.write(6, 6, "Piezas", header_format)
        sheet.write(6, 7, "Importe", header_format)

        # ======== ARMAR DICCIONARIO RESUMEN ========
        dicc_summary = {'lines': []}

        for sp in stock_picking_ids:
            wh = sp.picking_type_id.warehouse_id
            _logger.info(f"stock picking id {sp.id}, name {sp.name} wh {wh.name} hora efectiva {sp.date_done}")
            for line in sp.move_ids_without_package:

                if wh.id not in dicc_summary:
                    dicc_summary[wh.id] = {
                        'name': wh.name,
                        'sales_material': {'pieces': 0, 'amount': 0},
                        'finished_product': {'pieces': 0, 'amount': 0},
                    }

                if line.id not in dicc_summary['lines']:
                    
                    if 'PT - ' in line.product_id.name or 'PT- ' in line.product_id.name:  # PRODUCTO TERMINADO
                        _logger.info(f"Id line {line.id} Producto '{line.product_id.name}' Cantidad {line.quantity_done} clasificado como PRODUCTO TERMINADO")
                        dicc_summary[wh.id]['finished_product']['pieces'] += line.quantity_done
                        dicc_summary[wh.id]['finished_product']['amount'] += (line.quantity_done * line.product_id.standard_price)

                    else:  # MATERIAL DE VENTA
                        _logger.warning(f"Producto '{line.product_id.name}' clasificado como MATERIAL DE VENTA")
                        dicc_summary[wh.id]['sales_material']['pieces'] += line.quantity_done
                        dicc_summary[wh.id]['sales_material']['amount'] += (line.quantity_done * line.product_id.standard_price)

                    dicc_summary['lines'].append(line.id)
            _logger.info("\n\n\n")
        # ======== ESCRIBIR LAS FILAS ========
        row = 7
        counter = 1

        for wh_id, data in dicc_summary.items():
            if wh_id == "lines":
                continue

            pt = data['finished_product']
            mv = data['sales_material']

            total_pieces = pt['pieces'] + mv['pieces']
            total_amount = pt['amount'] + mv['amount']

            sheet.write(row, 0, counter, cell_format)
            sheet.write(row, 1, data['name'], cell_format)

            sheet.write(row, 2, pt['pieces'], cell_format)
            sheet.write(row, 3, pt['amount'], money_format)

            sheet.write(row, 4, mv['pieces'], cell_format)
            sheet.write(row, 5, mv['amount'], money_format)

            sheet.write(row, 6, total_pieces, cell_format)
            sheet.write(row, 7, total_amount, money_format)

            counter += 1
            row += 1

        workbook.close()
        file_data = base64.b64encode(output.getvalue())

        self.write({
            'file_ex': file_data,
            'file_name': 'resumen_movimientos.xlsx'
        })

        return {
            "type": "ir.actions.act_url",
            "url": "/web/content/?model=%s&id=%s&field=file_ex&download=true&filename=%s" %
                   (self._name, self.id, self.file_name),
            "target": "self",
        }

