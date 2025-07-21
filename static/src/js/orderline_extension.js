odoo.define('l10n_mx_quemen.OrderlineExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _orderline_super = models.Orderline.prototype;

    models.Orderline = models.Orderline.extend({
        set_quantity: function(quantity, keep_price) {
            console.log("🔢 [l10n_mx_quemen] set_quantity", quantity);

            const res = _orderline_super.set_quantity.apply(this, [quantity, keep_price]);

            if (this.is_program_reward || quantity === 'remove') {
                return res;
            }

            setTimeout(() => {
                const order = this.order;
                const product = this.product;

                if (!order || !order.pos || !order.pos.promo_programs || !product) {
                    return;
                }

                const rewardLines = order.get_orderlines().filter(line => line.is_program_reward);
                if (!rewardLines.length) {
                    console.log("⛔ No hay rewardLines, saliendo.");
                    return;
                }

                const lastRewardLine = rewardLines[rewardLines.length - 1];
                const program = order.pos.promo_programs.find(p => p.id === lastRewardLine.program_id);

                if (
                    !program ||
                    !program.discount_logic ||
                    program.reward_type !== 'discount' ||
                    !program.rule_min_quantity
                ) {
                    console.log("⛔ Programa no válido o no aplica lógica de descuento.");
                    return;
                }

                const validProductIds = new Set(program.valid_product_ids || []);

                const validLines = order
                    .get_orderlines()
                    .filter(l => validProductIds.has(l.product.id) && !l.is_program_reward);

                if (!validLines.length) {
                    console.log("⛔ No hay productos válidos en el pedido. No se actualiza rewardLine.");
                    return;
                }

                const appliedQty = validLines.reduce((sum, l) => sum + l.quantity, 0);
                const minQty = program.rule_min_quantity;
                const groups = Math.floor(appliedQty / minQty);
                const allowedRewardQty = groups * (program.reward_product_quantity || 1);

                if (allowedRewardQty >= 1) {
                    const discountPerUnit = validLines[0].product.lst_price * (program.discount_percentage / 100);
                    const newDiscountTotal = allowedRewardQty * discountPerUnit;
                    lastRewardLine.set_unit_price(-newDiscountTotal);
                    console.log(`✅ Precio ajustado: -${newDiscountTotal} por ${allowedRewardQty} unidad(es)`);
                } else {
                    lastRewardLine.set_unit_price(0);
                    console.log("⛔ No se cumple la cantidad mínima, descuento eliminado");
                }
            }, 0); // 🔁 Esperamos al próximo ciclo de eventos

            return res;
        },
    });

    return models.Orderline;
});
