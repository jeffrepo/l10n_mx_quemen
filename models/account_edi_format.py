# -*- coding: utf-8 -*-
from odoo import api, models, fields, tools, _
from odoo.tools.float_utils import float_round, float_is_zero

class AccountEdiFormat(models.Model):
    _inherit = 'account.edi.format'

    def _l10n_mx_edi_get_invoice_cfdi_values(self, invoice):
        # Primero llamamos al método original
        cfdi_values = super(AccountEdiFormat, self)._l10n_mx_edi_get_invoice_cfdi_values(invoice)
        
        # Verificamos si hay líneas con precio negativo (descuentos)
        discount_lines = [line_vals for line_vals in cfdi_values['invoice_line_vals_list'] 
                         if line_vals['line'].price_unit < 0]
        
        if not discount_lines:
            return cfdi_values
        
        # Buscamos programas de cupones
        coupon_programs = self.env['coupon.program'].search([])
        
        for discount_line_vals in discount_lines:
            discount_line = discount_line_vals['line']
            
            # Buscamos si este producto de descuento está en algún coupon.program
            matching_programs = coupon_programs.filtered(
                lambda p: p.discount_line_product_id.id == discount_line.product_id.id
            )
            
            if not matching_programs:
                continue
                
            # Para cada programa de cupón encontrado
            for program in matching_programs:
                if program.discount_type == 'specific_products' and program.discount_specific_product_ids:
                    # Productos específicos a los que aplica el descuento
                    target_product_ids = program.discount_specific_product_ids.ids
                    
                    # Buscamos las líneas de factura que contienen estos productos
                    target_line_vals = [line_vals for line_vals in cfdi_values['invoice_line_vals_list'] 
                                      if line_vals['line'].product_id.id in target_product_ids 
                                      and line_vals['line'].price_unit >= 0]
                    
                    if not target_line_vals:
                        continue
                    
                    # Calculamos el monto total de los productos objetivo
                    total_target_amount = sum(line_vals['price_subtotal_before_discount'] 
                                            for line_vals in target_line_vals)
                    
                    if float_is_zero(total_target_amount, precision_digits=2):
                        continue
                    
                    # Distribuimos el descuento proporcionalmente
                    discount_amount = abs(discount_line_vals['price_subtotal_before_discount'])
                    
                    for target_line_vals in target_line_vals:
                        # Calculamos la proporción
                        proportion = target_line_vals['price_subtotal_before_discount'] / total_target_amount
                        
                        # Monto de descuento para esta línea
                        line_discount_amount = discount_amount * proportion
                        
                        # Aplicamos el descuento
                        target_line_vals['price_discount'] += line_discount_amount
                        
                        # Actualizamos el subtotal
                        target_line_vals['price_subtotal'] = (
                            target_line_vals['price_subtotal_before_discount'] - 
                            target_line_vals['price_discount']
                        )
        
        # Removemos las líneas de descuento originales
        cfdi_values['invoice_line_vals_list'] = [
            line_vals for line_vals in cfdi_values['invoice_line_vals_list'] 
            if line_vals['line'].price_unit >= 0
        ]
        
        # Recalculamos los totales
        cfdi_values.update({
            'total_price_subtotal_before_discount': sum(
                x['price_subtotal_before_discount'] for x in cfdi_values['invoice_line_vals_list']
            ),
            'total_price_discount': sum(
                x['price_discount'] for x in cfdi_values['invoice_line_vals_list']
            ),
            'total_price_subtotal': sum(
                x['price_subtotal'] for x in cfdi_values['invoice_line_vals_list']
            ),
        })
        
        return cfdi_values