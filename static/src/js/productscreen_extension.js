odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    // Cambiar a true solo para diagnóstico puntual.
    const DEBUG_PROMO = false;

    function log() {
        if (DEBUG_PROMO) {
            console.log.apply(console, ['[PROMO_CUSTOM]'].concat(Array.from(arguments)));
        }
    }

    function warn() {
        if (DEBUG_PROMO) {
            console.warn.apply(console, ['[PROMO_CUSTOM]'].concat(Array.from(arguments)));
        }
    }

    models.Order = models.Order.extend({
        add_product: function(product, options) {
            const res = _super_order.add_product.apply(this, arguments);
            const isRewardAdd = options && options.extras && options.extras.reward_id;

            Promise.resolve(res).then(() => {
                if (!this._applying_custom_2x1_promos && !this._adding_custom_reward_line && !isRewardAdd) {
                    this._schedule_custom_2x1_promos('add_product');
                }
            });

            return res;
        },

        set_orderline_options: function(line, options) {
            const res = _super_order.set_orderline_options
                ? _super_order.set_orderline_options.apply(this, arguments)
                : undefined;

            if (!this._applying_custom_2x1_promos && !this._adding_custom_reward_line) {
                this._schedule_custom_2x1_promos('set_orderline_options');
            }

            return res;
        },

        remove_orderline: function(line) {
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            const programId = this._get_program_id_from_reward_line(line);
            const isRewardLine = line && (
                line.is_program_reward ||
                line.program_id ||
                line.reward_id ||
                programId
            );

            const manualRemove = isRewardLine && line._manual_reward_remove_requested;

            if (manualRemove && !this._suppress_reward_manual_remove) {
                if (programId) {
                    log('Promo eliminada manualmente', programId);
                    this._manually_removed_program_ids.add(programId);

                    if (Array.isArray(this.activePromoProgramIds)) {
                        this.activePromoProgramIds = this.activePromoProgramIds.filter(id => id !== programId);
                    }
                }
            }

            const res = _super_order.remove_orderline.apply(this, arguments);

            if (!isRewardLine && !this._applying_custom_2x1_promos && !this._adding_custom_reward_line) {
                this._schedule_custom_2x1_promos('remove_normal_line');
            }

            return res;
        },

        resetPrograms: function() {
            this._manually_removed_program_ids = new Set();

            const res = _super_order.resetPrograms
                ? _super_order.resetPrograms.apply(this, arguments)
                : undefined;

            this._schedule_custom_2x1_promos('resetPrograms');

            return res;
        },

        _has_normal_sale_lines: function() {
            return this.get_orderlines().some(line => {
                return line.product &&
                    !line.is_program_reward &&
                    !line.program_id &&
                    !line.reward_id;
            });
        },

        _is_safe_to_recalculate_promos: function() {
            if (!this.pos || !this.pos.get_order || this.pos.get_order() !== this) {
                return false;
            }

            if (!this._has_normal_sale_lines()) {
                return false;
            }

            return true;
        },

        _schedule_custom_2x1_promos: function(reason) {
            if (!this._is_safe_to_recalculate_promos()) {
                log('schedule ignorado: no es seguro recalcular', reason);
                return;
            }

            if (this._custom_2x1_timer) {
                clearTimeout(this._custom_2x1_timer);
            }

            this._custom_2x1_timer = setTimeout(() => {
                if (this._is_safe_to_recalculate_promos()) {
                    this._apply_custom_2x1_promos(reason);
                }
            }, 600);
        },

        _get_discount_logic_programs: function() {
            return (this.pos.promo_programs || [])
                .filter(program => {
                    return program.discount_logic &&
                        program.reward_type === 'discount' &&
                        program.discount_apply_on === 'specific_products';
                })
                .sort((a, b) => {
                    const seqA = a.sequence || 0;
                    const seqB = b.sequence || 0;
                    return seqA === seqB ? a.id - b.id : seqA - seqB;
                });
        },

        _remove_discount_logic_from_active_programs: function(programs) {
            if (!Array.isArray(this.activePromoProgramIds)) {
                return;
            }

            const customIds = new Set(programs.map(p => p.id));
            this.activePromoProgramIds = this.activePromoProgramIds.filter(id => !customIds.has(id));
        },

        _get_program_id_from_reward_line: function(line) {
            if (!line) {
                return false;
            }

            if (line.program_id || line.reward_id) {
                return line.program_id || line.reward_id;
            }

            if (!line.product || !this.pos || !this.pos.promo_programs) {
                return false;
            }

            const program = this.pos.promo_programs.find(p => {
                const rewardProductId = Array.isArray(p.discount_line_product_id)
                    ? p.discount_line_product_id[0]
                    : p.discount_line_product_id;

                return rewardProductId === line.product.id;
            });

            return program ? program.id : false;
        },

        _get_program_reward_lines: function(program) {
            const rewardProductId = Array.isArray(program.discount_line_product_id)
                ? program.discount_line_product_id[0]
                : program.discount_line_product_id;

            return this.get_orderlines().filter(line => {
                if (!line || !line.product) {
                    return false;
                }

                return (
                    line.program_id === program.id ||
                    line.reward_id === program.id ||
                    (
                        line.product.id === rewardProductId &&
                        (!line.program_id || line.program_id === program.id) &&
                        (!line.reward_id || line.reward_id === program.id)
                    )
                );
            });
        },

        _mark_reward_line: function(line, program, amount) {
            // Marcar primero para que set_quantity no dispare recálculos como línea normal.
            line.is_program_reward = true;
            line.program_id = program.id;
            line.reward_id = program.id;
            line.price_manually_set = true;

            line.set_quantity(1);
            line.set_unit_price(-amount);
            line.trigger('change', line);
        },

        _create_custom_reward_line: function(program, rewardProduct, totalDiscount) {
            // Importante: NO usar add_product() para rewards custom.
            // add_product dispara lógica estándar de Odoo que puede tocar rewards de otras promos.
            const rewardLine = new models.Orderline({}, {
                pos: this.pos,
                order: this,
                product: rewardProduct,
            });

            this._mark_reward_line(rewardLine, program, totalDiscount);

            this._adding_custom_reward_line = true;
            try {
                this.add_orderline(rewardLine);
                this.select_orderline(rewardLine);
                this.trigger('change', this);
            } finally {
                this._adding_custom_reward_line = false;
            }

            log('línea de descuento creada por add_orderline', program.id, -totalDiscount);
            return rewardLine;
        },

        _minutes_from_custom_date: function(date) {
            return date.getHours() * 60 + date.getMinutes();
        },

        _custom_time_in_range: function(currentMinutes, startMinutes, endMinutes) {
            if (startMinutes === endMinutes) {
                return true;
            }

            if (startMinutes < endMinutes) {
                return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
            }

            return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        },

        _check_discount_logic_program_rules: function(program, normalLines, totalQty) {
            if (!program) {
                return { successful: false, reason: 'Missing program.' };
            }

            const minQty = program.rule_min_quantity || 1;

            if (totalQty < minQty) {
                return {
                    successful: false,
                    reason: "Program's minimum quantity is not satisfied.",
                };
            }

            const orderDate = new Date();

            if (program.rule_date_from && program.rule_date_to) {
                const ruleFrom = this._convertToDate(program.rule_date_from);
                const ruleTo = this._convertToDate(program.rule_date_to);

                if (!(orderDate >= ruleFrom && orderDate <= ruleTo)) {
                    return { successful: false, reason: 'Program already expired.' };
                }

                const orderMinutes = this._minutes_from_custom_date(orderDate);
                const ruleFromMinutes = this._minutes_from_custom_date(ruleFrom);
                const ruleToMinutes = this._minutes_from_custom_date(ruleTo);

                if (!this._custom_time_in_range(orderMinutes, ruleFromMinutes, ruleToMinutes)) {
                    return { successful: false, reason: 'Program outside allowed hours.' };
                }
            }

            const partnersDomain = program.rule_partners_domain || '[]';
            if (partnersDomain !== '[]') {
                const customer = this.get_client();
                if (!program.valid_partner_ids || !program.valid_partner_ids.has(customer ? customer.id : 0)) {
                    return { successful: false, reason: "Current customer can't avail this program." };
                }
            }

            const amountToCheck = normalLines.reduce((sum, line) => {
                if (program.rule_minimum_amount_tax_inclusion === 'tax_included' && line.get_price_with_tax) {
                    return sum + line.get_price_with_tax();
                }
                if (line.get_price_without_tax) {
                    return sum + line.get_price_without_tax();
                }
                return sum + (line.get_unit_price() * line.get_quantity());
            }, 0);

            const minimumAmount = program.rule_minimum_amount || 0;

            if (amountToCheck + 0.00001 < minimumAmount) {
                return {
                    successful: false,
                    reason: 'Minimum amount for this program is not satisfied.',
                    amountToCheck: amountToCheck,
                    minimumAmount: minimumAmount,
                };
            }

            return {
                successful: true,
                amountToCheck: amountToCheck,
            };
        },

        _debug_order_lines: function(program) {
            const rewardProductId = program
                ? (Array.isArray(program.discount_line_product_id)
                    ? program.discount_line_product_id[0]
                    : program.discount_line_product_id)
                : false;

            return this.get_orderlines().map(line => ({
                cid: line.cid,
                product_id: line.product && line.product.id,
                product: line.product && line.product.display_name,
                qty: line.get_quantity && line.get_quantity(),
                price: line.get_unit_price && line.get_unit_price(),
                is_program_reward: line.is_program_reward,
                program_id: line.program_id,
                reward_id: line.reward_id,
                price_manually_set: line.price_manually_set,
                is_reward_product: rewardProductId && line.product && line.product.id === rewardProductId,
            }));
        },

        _apply_custom_2x1_promos: async function(reason) {
            if (!this._is_safe_to_recalculate_promos()) {
                return;
            }

            if (this._applying_custom_2x1_promos) {
                return;
            }

            this._applying_custom_2x1_promos = true;
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            try {
                const order = this;
                const programs = order._get_discount_logic_programs();

                // Las promos discount_logic las maneja este custom.
                order._remove_discount_logic_from_active_programs(programs);

                // Guard por línea, no por product_id.
                const usedLineIds = new Set();

                for (const program of programs) {
                    const rewardProductId = Array.isArray(program.discount_line_product_id)
                        ? program.discount_line_product_id[0]
                        : program.discount_line_product_id;

                    const validProductIds = program.valid_product_ids instanceof Set
                        ? program.valid_product_ids
                        : new Set(program.valid_product_ids || []);

                    const discountProductIds = program.discount_specific_product_ids instanceof Set
                        ? program.discount_specific_product_ids
                        : new Set(program.discount_specific_product_ids || []);

                    const normalLines = order.get_orderlines().filter(line => {
                        return !line.is_program_reward &&
                            !line.program_id &&
                            !line.reward_id &&
                            line.product &&
                            validProductIds.has(line.product.id) &&
                            !usedLineIds.has(line.cid);
                    });

                    const totalQty = normalLines.reduce((sum, line) => {
                        return sum + line.get_quantity();
                    }, 0);

                    if (order._manually_removed_program_ids.has(program.id)) {
                        order._remove_custom_reward_lines(program.id, 'manual_removed');
                        continue;
                    }

                    const check = order._check_discount_logic_program_rules(program, normalLines, totalQty);

                    if (!check || !check.successful) {
                        order._remove_custom_reward_lines(program.id, 'check_failed');
                        continue;
                    }

                    const rewardProduct = order.pos.db.get_product_by_id(rewardProductId);

                    if (!rewardProduct) {
                        warn('No existe reward product en POS', program.id, rewardProductId);
                        continue;
                    }

                    const minQty = program.rule_min_quantity || 1;

                    const discountableLines = normalLines.filter(line =>
                        discountProductIds.has(line.product.id)
                    );

                    if (!discountableLines.length) {
                        order._remove_custom_reward_lines(program.id, 'no_discountable_lines');
                        continue;
                    }

                    const groups = Math.floor(totalQty / minQty);
                    const rewardQtyPerGroup = program.reward_product_quantity || 1;
                    let remainingRewards = groups * rewardQtyPerGroup;

                    if (remainingRewards <= 0) {
                        order._remove_custom_reward_lines(program.id, 'remaining_rewards_zero');
                        continue;
                    }

                    const sortedLines = discountableLines
                        .slice()
                        .sort((a, b) => a.get_unit_price() - b.get_unit_price());

                    let totalDiscount = 0;
                    const consumedLines = new Set();

                    for (const line of sortedLines) {
                        if (remainingRewards <= 0) {
                            break;
                        }

                        const lineQty = line.get_quantity();
                        const qtyToDiscount = Math.min(lineQty, remainingRewards);
                        const percent = program.discount_percentage || 0;

                        totalDiscount += line.get_unit_price() * qtyToDiscount * (percent / 100);
                        remainingRewards -= qtyToDiscount;
                        consumedLines.add(line.cid);
                    }

                    totalDiscount = Math.round(totalDiscount * 100) / 100;

                    if (totalDiscount <= 0) {
                        order._remove_custom_reward_lines(program.id, 'discount_zero');
                        continue;
                    }

                    for (const cid of consumedLines) {
                        usedLineIds.add(cid);
                    }

                    const existingRewardLines = order._get_program_reward_lines(program);

                    if (existingRewardLines.length) {
                        const rewardLine = existingRewardLines[0];

                        order._mark_reward_line(rewardLine, program, totalDiscount);

                        if (existingRewardLines.length > 1) {
                            order._suppress_reward_manual_remove = true;
                            try {
                                for (const extraLine of existingRewardLines.slice(1)) {
                                    order.remove_orderline(extraLine);
                                }
                            } finally {
                                order._suppress_reward_manual_remove = false;
                            }
                        }

                        continue;
                    }

                    order._create_custom_reward_line(program, rewardProduct, totalDiscount);
                }
            } finally {
                this._applying_custom_2x1_promos = false;
            }
        },

        _remove_custom_reward_lines: function(programId, reason) {
            const program = (this.pos.promo_programs || []).find(p => p.id === programId);
            let rewardLines = [];

            if (program) {
                rewardLines = this._get_program_reward_lines(program);
            } else {
                rewardLines = this.get_orderlines().filter(line =>
                    (line.is_program_reward && line.program_id === programId) ||
                    line.program_id === programId ||
                    line.reward_id === programId
                );
            }

            if (!rewardLines.length) {
                return;
            }

            this._suppress_reward_manual_remove = true;
            try {
                for (const line of rewardLines) {
                    this.remove_orderline(line);
                }
            } finally {
                this._suppress_reward_manual_remove = false;
            }
        },
    });

    return models.Order;
});
