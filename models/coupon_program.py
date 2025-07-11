# -*- coding: utf-8 -*-

from odoo import fields, models, _

class CouponProgram(models.Model):
    _inherit = 'coupon.program'

    discount_logic = fields.Boolean("logica descuento personalizada ", default=False)
