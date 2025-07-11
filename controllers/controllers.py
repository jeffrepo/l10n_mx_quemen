# -*- coding: utf-8 -*-
# from odoo import http


# class L10nMxQuemen(http.Controller):
#     @http.route('/l10n_mx_quemen/l10n_mx_quemen', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/l10n_mx_quemen/l10n_mx_quemen/objects', auth='public')
#     def list(self, **kw):
#         return http.request.render('l10n_mx_quemen.listing', {
#             'root': '/l10n_mx_quemen/l10n_mx_quemen',
#             'objects': http.request.env['l10n_mx_quemen.l10n_mx_quemen'].search([]),
#         })

#     @http.route('/l10n_mx_quemen/l10n_mx_quemen/objects/<model("l10n_mx_quemen.l10n_mx_quemen"):obj>', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('l10n_mx_quemen.object', {
#             'object': obj
#         })
