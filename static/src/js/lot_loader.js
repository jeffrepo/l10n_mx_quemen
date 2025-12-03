odoo.define('l10n_mx_quemen.lot_loader', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const rpc = require('web.rpc');

    const _super_posmodel = models.PosModel.prototype;

    models.PosModel = models.PosModel.extend({
        initialize: function(attributes, options) {
            const self = this;
            // Ejecuta la inicialización original
            _super_posmodel.initialize.apply(this, arguments);

            console.log('🔄 Cargando lotes disponibles desde Python...');

            // Hacemos la llamada una vez para guardar en memoria
            rpc.query({
                model: 'stock.production.lot',
                method: 'get_available_lots_for_pos',
                args: [],
            }).then(function(result) {
                self.lot_dict = result || {};
                console.log('✅ Lotes cargados:', self.lot_dict);
            }).catch(function(err) {
                console.error('❌ Error cargando lotes:', err);
            });
        },
    });
});
