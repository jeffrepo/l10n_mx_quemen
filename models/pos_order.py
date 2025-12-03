# -*- coding: utf-8 -*-

from odoo import api, models, fields, _
from odoo.exceptions import UserError

class PosOrder(models.Model):
    _inherit = 'pos.order'

    def _prepare_invoice_lines(self):
        """
        Prepara las líneas de la factura consolidando los descuentos de cupones
        antes de que se creen las líneas con valores negativos.
        """
        invoice_lines = super(PosOrder, self)._prepare_invoice_lines()
        
        # Obtener todos los productos de descuento de cupones
        coupon_program_discount_products = self.env['coupon.program'].search([]).mapped('discount_line_product_id')
        discount_product_ids = coupon_program_discount_products.ids
        
        # Separar líneas normales y líneas de descuento
        normal_lines = []
        discount_lines = []
        
        for line in invoice_lines:
            if line[0] == 0:  # CREATE command
                line_vals = line[2]
                product_id = line_vals.get('product_id')
                
                if product_id and product_id in discount_product_ids and line_vals.get('price_unit', 0) < 0:
                    discount_lines.append((line, line_vals))
                else:
                    normal_lines.append((line, line_vals))
            else:
                normal_lines.append((line, None))
        
        # Si no hay líneas de descuento, retornar las líneas originales
        if not discount_lines:
            return invoice_lines
        
        # Procesar descuentos y aplicarlos a las líneas correspondientes
        discount_amounts = {}
        discount_details = {}
        
        for discount_command, discount_vals in discount_lines:
            discount_amount = abs(discount_vals.get('price_unit', 0)) * discount_vals.get('quantity', 1)
            
            # Buscar el programa de cupón relacionado
            program = self.env['coupon.program'].search([
                ('discount_line_product_id', '=', discount_vals.get('product_id'))
            ], limit=1)
            
            if program:
                if program.discount_apply_on == 'specific_products' and program.discount_specific_product_ids:
                    # Descuento aplicado a productos específicos
                    target_products = program.discount_specific_product_ids
                    target_found = False
                    
                    for target_product in target_products:
                        # Buscar líneas que coincidan con el producto objetivo
                        for normal_command, normal_vals in normal_lines:
                            if normal_vals and normal_vals.get('product_id') == target_product.id:
                                if target_product.id not in discount_amounts:
                                    discount_amounts[target_product.id] = 0
                                    discount_details[target_product.id] = []
                                
                                discount_amounts[target_product.id] += discount_amount
                                discount_details[target_product.id].append({
                                    'amount': discount_amount,
                                    'program_name': program.name
                                })
                                target_found = True
                                break
                        
                        if target_found:
                            break
                    
                    if not target_found and normal_lines:
                        # Si no se encuentra el producto específico, aplicar al primer producto
                        first_product_id = normal_lines[0][1].get('product_id') if normal_lines[0][1] else None
                        if first_product_id:
                            if first_product_id not in discount_amounts:
                                discount_amounts[first_product_id] = 0
                                discount_details[first_product_id] = []
                            
                            discount_amounts[first_product_id] += discount_amount
                            discount_details[first_product_id].append({
                                'amount': discount_amount,
                                'program_name': program.name
                            })
                else:
                    # Descuento general - aplicar proporcionalmente
                    total_normal_value = 0
                    for normal_command, normal_vals in normal_lines:
                        if normal_vals:
                            total_normal_value += normal_vals.get('price_unit', 0) * normal_vals.get('quantity', 1)
                    
                    if total_normal_value > 0:
                        for normal_command, normal_vals in normal_lines:
                            if normal_vals:
                                product_id = normal_vals.get('product_id')
                                line_value = normal_vals.get('price_unit', 0) * normal_vals.get('quantity', 1)
                                line_ratio = line_value / total_normal_value
                                line_discount = discount_amount * line_ratio
                                
                                if product_id not in discount_amounts:
                                    discount_amounts[product_id] = 0
                                    discount_details[product_id] = []
                                
                                discount_amounts[product_id] += line_discount
                                discount_details[product_id].append({
                                    'amount': line_discount,
                                    'program_name': program.name
                                })
                    elif normal_lines:
                        # Si no hay valor total, aplicar al primer producto
                        first_product_id = normal_lines[0][1].get('product_id') if normal_lines[0][1] else None
                        if first_product_id:
                            if first_product_id not in discount_amounts:
                                discount_amounts[first_product_id] = 0
                                discount_details[first_product_id] = []
                            
                            discount_amounts[first_product_id] += discount_amount
                            discount_details[first_product_id].append({
                                'amount': discount_amount,
                                'program_name': program.name
                            })
        
        # Crear nuevas líneas con descuentos aplicados
        new_invoice_lines = []
        
        for line_command, line_vals in normal_lines:
            if line_vals:
                product_id = line_vals.get('product_id')
                
                if product_id in discount_amounts:
                    total_discount = discount_amounts[product_id]
                    
                    # Calcular nuevo precio unitario
                    original_total = line_vals.get('price_unit', 0) * line_vals.get('quantity', 1)
                    new_total = original_total - total_discount
                    
                    if line_vals.get('quantity', 1) > 0:
                        new_price_unit = new_total / line_vals.get('quantity', 1)
                    else:
                        new_price_unit = 0
                    
                    # Preparar descripción con información de descuento
                    discount_info = ""
                    for detail in discount_details.get(product_id, []):
                        discount_info += f"\nDescuento {detail['program_name']}: {detail['amount']:.2f}"
                    
                    # Crear nueva línea con descuento aplicado
                    new_line_vals = line_vals.copy()
                    new_line_vals['price_unit'] = new_price_unit
                    new_line_vals['name'] = f"{line_vals.get('name', '')}{discount_info}"
                    
                    new_invoice_lines.append((0, 0, new_line_vals))
                else:
                    new_invoice_lines.append(line_command)
            else:
                new_invoice_lines.append(line_command)
        
        return new_invoice_lines

    def _prepare_invoice(self):
        """
        Aseguramos que las líneas preparadas incluyan los ajustes de descuento
        """
        invoice_vals = super(PosOrder, self)._prepare_invoice()
        
        # Reemplazar las líneas de la factura con nuestras líneas ajustadas
        if 'invoice_line_ids' in invoice_vals:
            invoice_vals['invoice_line_ids'] = self._prepare_invoice_lines()
        
        return invoice_vals