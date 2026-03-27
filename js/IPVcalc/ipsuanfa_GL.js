export default function calculateIPV_GL(inputs, cantonRules) {
    if (!inputs || typeof inputs !== 'object') return { error: 'INVALID_INPUT', annualBenefit: 0 };
    const r = cantonRules?.ipv || {};
  
    // --- 1. 计算 massgebendes Einkommen (LNA) ---
    // 公式: 收入 + 10% 财产 - 子女扣除 (每人5000，包括普通儿童和在学青年)
    const assetPart = (inputs.taxableAssets || 0) * r.asset_inclusion_rate;
    const totalChildrenAndYoung = (inputs.numChildren || 0) + (inputs.numEducation || 0);
    const childDeductionTotal = totalChildrenAndYoung * r.lna_child_deduction;
  
    const lna = Math.max(0,
        (inputs.netIncomeAnnual || 0) +
        assetPart +
        (inputs.propertyLosses || 0) -
        (inputs.ownRentalValue || 0) -
        (inputs.alimonyPaid || 0) -
        childDeductionTotal
    );
    // --- 2. 确定阶梯自负盈亏率 (Retention Rate) ---
    // 官方 2026 直接根据 LNA 确定税率
    let appliedRate = 0.14;
    for (const level of r.staggered_rates) {
        if (level.limit === null || lna <= level.limit) {
            appliedRate = level.rate;
            break;
        }
    }
    // --- 3. 计算参考保费总额 ---
    const totalRefPremium =
        (inputs.numAdults * r.ref_premium_annual.adult) +
        ((inputs.numEducation || 0) * r.ref_premium_annual.young_adult) +
        ((inputs.numChildren || 0) * r.ref_premium_annual.child);
    // --- 4. 计算初步补贴 ---
    const selfRetentionAmount = lna * appliedRate;
    let theoretical = Math.max(0, totalRefPremium - selfRetentionAmount);
    // --- 5. 最低保障 (LNA < 85'000) ---
    if (lna < r.guarantee_threshold_lna) {
        const minChild = (inputs.numChildren || 0) * r.ref_premium_annual.child * r.minimum_reduction.children;
        const minYoung = (inputs.numEducation || 0) * r.ref_premium_annual.young_adult * r.minimum_reduction.young_adults_in_education;
        theoretical = Math.max(theoretical, minChild + minYoung);
    }
    // --- 6. 特殊人群 (EL/Sozialhilfe) 100% 覆盖 ---
    if (inputs.isELRecipient || inputs.isSocialAssistanceRecipient) {
        theoretical = totalRefPremium;
    }
    // --- 7. 最终封顶与 100 CHF 限制 ---
    let finalBenefit = Math.round(theoretical);
    if (finalBenefit > 0 && finalBenefit < r.minimum_reduction.min_subsidy_chf) finalBenefit = 0;
  
    // 实际支付保费上限
    if (inputs.annualHealthPremium) {
        finalBenefit = Math.min(finalBenefit, inputs.annualHealthPremium);
    }
    // --- 返回统一格式的输出 ---
    return {
        annualBenefit: finalBenefit,
        monthlyBenefit: parseFloat((finalBenefit / 12).toFixed(2)),
        // 以下是用于前端显示的解释步骤 (对应 BE 州的样式)
        explanation: {
            steps: [
                { label: "1. Massgebendes Einkommen (LNA)", value: `${Math.round(lna)} CHF` },
                { label: "2. Davon Vermögensanteil (10%)", value: `${Math.round(assetPart)} CHF` },
                { label: "3. Abzug für Kinder im LNA", value: `${Math.round(childDeductionTotal)} CHF` },
                { label: "4. Angewandter Satz (%)", value: `${(appliedRate * 100).toFixed(1)} %` },
                { label: "5. Referenzprämien Total", value: `${Math.round(totalRefPremium)} CHF` },
                { label: "6. Finale IPV", value: `${finalBenefit} CHF/Jahr` }
            ]
        },
        // 技术元数据 (不直接显示给用户)
        metadata: {
            lna: Math.round(lna),
            rate: appliedRate,
            ref: totalRefPremium
        },
        error: null
    };
};