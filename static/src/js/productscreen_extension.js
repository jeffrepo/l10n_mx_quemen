odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    models.Order = models.Order.extend({
        add_product(product, options) {
            const res = _super_order.add_product.apply(this, arguments);

            const selectedProduct = this.get_selected_orderline()?.product;

            if (this.pos.promo_programs && selectedProduct) {
                setTimeout(() => {
                    const rewardLines = this.get_orderlines().filter(line => line.is_program_reward);

                    if (rewardLines.length) {
                        const lastRewardLine = rewardLines[rewardLines.length - 1];
                        const program = this.pos.promo_programs.find(p => p.id === lastRewardLine.program_id);

                        if (
                            program &&
                            program.discount_logic &&  // ✅ verificamos el nuevo campo
                            program.reward_type === 'discount' &&
                            program.rule_min_quantity
                        ) {
                            const appliedQty = this
                                .get_orderlines()
                                .filter(l => l.product.id === selectedProduct.id && !l.is_program_reward)
                                .reduce((sum, l) => sum + l.quantity, 0);

                            const minQty = program.rule_min_quantity;
                            const groups = Math.floor(appliedQty / minQty);
                            const allowedRewardQty = groups * (program.reward_product_quantity || 1);

                            if (allowedRewardQty >= 1) {
                                const discountPerUnit = selectedProduct.lst_price * (program.discount_percentage / 100);
                                const newDiscountTotal = allowedRewardQty * discountPerUnit;
                                lastRewardLine.set_unit_price(-newDiscountTotal);
                                console.log(`✅ Precio ajustado: -${newDiscountTotal} por ${allowedRewardQty} unidad(es)`);
                            } else {
                                lastRewardLine.set_unit_price(0);
                                console.log(`⛔ Descuento eliminado porque no se cumple la cantidad mínima`);
                            }
                        }
                    }
                }, 0);
            }

            return res;
        },
    });

    return models.Order;
});
