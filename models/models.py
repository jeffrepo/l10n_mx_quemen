# -*- coding: utf-8 -*-

# from odoo import models, fields, api


# class l10n_mx_quemen(models.Model):
#     _name = 'l10n_mx_quemen.l10n_mx_quemen'
#     _description = 'l10n_mx_quemen.l10n_mx_quemen'

#     name = fields.Char()
#     value = fields.Integer()
#     value2 = fields.Float(compute="_value_pc", store=True)
#     description = fields.Text()
#
#     @api.depends('value')
#     def _value_pc(self):
#         for record in self:
#             record.value2 = float(record.value) / 100
