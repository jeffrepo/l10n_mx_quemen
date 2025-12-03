odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    models.Order = models.Order.extend({
        async _processData(loadedData) {
            await this._super.apply(this, arguments);

            const lot_dict = await rpc.query({
                model: 'stock.production.lot',
                method: 'get_available_lots_for_pos',
                args: [],
            });

            this.lot_dict = lot_dict || {};
            console.log('✅ Lotes disponibles en POS:', this.lot_dict);
        },

        add_product(product, options) {
            const res = _super_order.add_product.apply(this, arguments);
            console.log("res ", res);

            const selectedProduct = this.get_selected_orderline()?.product;
            console.log("selectedProduct ", selectedProduct);

            if (this.pos.promo_programs && selectedProduct) {
                setTimeout(() => {
                    const rewardLines = this.get_orderlines().filter(line => line.is_program_reward);
                    console.log("rewardLines ", rewardLines);

                    if (!rewardLines.length) {
                        return;
                    }

                    // Agrupar rewardLines por programa
                    const rewardGroups = {};
                    for (const line of rewardLines) {
                        if (!rewardGroups[line.program_id]) {
                            rewardGroups[line.program_id] = [];
                        }
                        rewardGroups[line.program_id].push(line);
                    }

                    for (const programId in rewardGroups) {
                        const program = this.pos.promo_programs.find(p => p.id === parseInt(programId));
                        const groupRewardLines = rewardGroups[programId];

                        if (
                            program &&
                            program.discount_logic &&
                            program.reward_type === 'discount' &&
                            program.rule_min_quantity
                        ) {
                            // 👉 Verificar líneas válidas del producto de la promoción
                            const validLines = this
                                .get_orderlines()
                                .filter(l => program.valid_product_ids.has(l.product.id) && !l.is_program_reward);

                            if (!validLines.length) {
                                console.log(`⛔ [program_id: ${programId}] No hay productos válidos. No se actualiza rewardLine.`);
                                continue;
                            }

                            const appliedQty = validLines.reduce((sum, l) => sum + l.quantity, 0);
                            const minQty = program.rule_min_quantity;
                            const groups = Math.floor(appliedQty / minQty);
                            const allowedRewardQty = groups * (program.reward_product_quantity || 1);

                            const discountPerUnit = validLines[0].product.lst_price * (program.discount_percentage / 100);
                            const newDiscountTotal = allowedRewardQty * discountPerUnit;

                            // Aplica el descuento a cada reward line (puedes distribuir si hay varias)
                            for (const rewardLine of groupRewardLines) {
                                if (allowedRewardQty >= 1) {
                                    rewardLine.set_unit_price(-newDiscountTotal);
                                    console.log(`✅ [program_id: ${programId}] Precio ajustado: -${newDiscountTotal} por ${allowedRewardQty} unidad(es)`);
                                } else {
                                    rewardLine.set_unit_price(0);
                                    console.log(`⛔ [program_id: ${programId}] Descuento eliminado por no cumplir cantidad mínima`);
                                }
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

