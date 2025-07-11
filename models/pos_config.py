# -*- coding: utf-8 -*-

from odoo import fields, models, _

class PosConfig(models.Model):
    _inherit = 'pos.config'
    
    # This will update the existing field rather than create new
    employee_ids = fields.Many2many(
        'hr.employee',
        string='Allowed Employees',  # Update label
        # relation='x_hr_employee_pos_config_rel'  # Ensure same relation table
    )