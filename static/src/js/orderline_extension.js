odoo.define('l10n_mx_quemen.OrderlineExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _orderline_super = models.Orderline.prototype;

    // Cambiar a true solo para diagnóstico puntual.
    const DEBUG_PROMO = false;

    function log() {
        if (DEBUG_PROMO) {
            console.log.apply(console, ['[PROMO_ORDERLINE]'].concat(Array.from(arguments)));
        }
    }

    models.Orderline = models.Orderline.extend({
        set_quantity: function(quantity, keep_price) {
            const isRewardLine = this.is_program_reward || this.program_id || this.reward_id;

            if (quantity === 'remove' && isRewardLine) {
                this._manual_reward_remove_requested = true;
                log('reward line marcada para eliminación manual', {
                    product_id: this.product && this.product.id,
                    product: this.product && this.product.display_name,
                    program_id: this.program_id,
                    reward_id: this.reward_id,
                });
            }

            return _orderline_super.set_quantity.apply(this, arguments);
        },

        export_as_JSON: function() {
            const json = _orderline_super.export_as_JSON.apply(this, arguments);

            json.is_program_reward = this.is_program_reward || false;
            json.program_id = this.program_id || false;
            json.reward_id = this.reward_id || false;
            json.price_manually_set = this.price_manually_set || false;

            return json;
        },

        init_from_JSON: function(json) {
            _orderline_super.init_from_JSON.apply(this, arguments);

            this.is_program_reward = json.is_program_reward || false;
            this.program_id = json.program_id || false;
            this.reward_id = json.reward_id || false;
            this.price_manually_set = json.price_manually_set || false;
        },

        can_be_merged_with: function(orderline) {
            if (
                this.is_program_reward ||
                this.program_id ||
                this.reward_id ||
                (orderline && (orderline.is_program_reward || orderline.program_id || orderline.reward_id))
            ) {
                return false;
            }

            return _orderline_super.can_be_merged_with.apply(this, arguments);
        },
    });

    return models.Orderline;
});
