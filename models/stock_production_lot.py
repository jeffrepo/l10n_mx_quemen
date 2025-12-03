# models/stock_production_lot.py
from odoo import models, api

class StockProductionLot(models.Model):
    _inherit = 'stock.production.lot'

    @api.model
    def get_available_lots_for_pos(self):
        # 1. Obtener los productos que están en el POS
        product_ids = self.env['product.product'].search([
            ('available_in_pos', '=', True),
        ]).ids

        # 2. Buscar los quants con stock disponible en ubicaciones internas
        StockQuant = self.env['stock.quant']
        lots = StockQuant.read_group(
            domain=[
                ('product_id', 'in', product_ids),
                ('location_id.usage', '=', 'internal'),
                ('quantity', '>', 0),
                ('lot_id', '!=', False),
            ],
            fields=['lot_id'],
            groupby=['lot_id']
        )
        lot_ids = [group['lot_id'][0] for group in lots if group['lot_id']]
        lot_objs = self.browse(lot_ids)
        return {lot.id: lot.name for lot in lot_objs}
