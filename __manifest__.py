# -*- coding: utf-8 -*-
{
    'name': "l10n_mx_quemen",

    'summary': "Lógica personalizada para aplicar descuentos por cantidad en promociones POS",

    'description': """
Este módulo extiende el comportamiento de las promociones en el Punto de Venta de Odoo para aplicar una lógica de descuentos más precisa basada en la cantidad de productos adquiridos.

Características principales:
- Permite activar una lógica personalizada por programa de cupones.
- Ajusta dinámicamente el monto del descuento según grupos completos de productos comprados.
- Aplica solo a promociones con tipo de recompensa 'Descuento'.
- Evita aplicar descuentos excesivos cuando no se cumplen los mínimos de cantidad.

Ideal para escenarios como "Compra 2, el segundo al 50%" o "Compra 4 y recibe 2 con descuento".
""",

    'author': "SISPAV",
    'website': "http://www.yourcompany.com",

    'category': 'Point of Sale',
    'version': '0.1',
    'license': 'LGPL-3',

    'depends': ['base', 'point_of_sale', 'pos_coupon'],

    'data': [
        'views/coupon_program_views.xml',
    ],
    'assets': {
        'point_of_sale.assets': [
            'l10n_mx_quemen/static/src/js/productscreen_extension.js',
            'l10n_mx_quemen/static/src/js/orderline_extension.js',
        ],
    },
}

