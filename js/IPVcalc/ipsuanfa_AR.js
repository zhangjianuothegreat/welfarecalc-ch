// elsuanfa_AR.js – 2026 外阿彭策尔州 (AR) IPV 算法 [全透明详细版]
export default function calculateIPV_AR(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { annualBenefit: 0, monthlyBenefit: 0, isEligible: false };
  }

  // --- 1. 数据预处理 (防止 undefined 导致的计算中断) ---
  const safeInputs = {
    numAdults: Number(inputs.numAdults) || 1,
    numChildren: Number(inputs.numChildren) || 0,
    numYoungAdults: Number(inputs.numYoungAdults || inputs.numEducation || 0),
    // 兼容主程序可能发送的不同键名
    taxableIncomeAnnual: Number(inputs.taxableIncomeAnnual || inputs.netIncomeAnnual || inputs.annualIncome || 0),
    taxableAssets: Number(inputs.taxableAssets || 0),
    annualHealthPremium: Number(inputs.annualHealthPremium || 0),
    propertyExpenses: Number(inputs.propertyExpenses || 0),
    pillar3a: Number(inputs.pillar3a || 0),
    hasVocationalPension: !!inputs.hasVocationalPension,
    vocationalPurchases: Number(inputs.vocationalPurchases || 0),
    previousLosses: Number(inputs.previousLosses || 0),
    simplifiedIncomes: Number(inputs.simplifiedIncomes || 0),
    partyContributions: Number(inputs.partyContributions || 0),
    voluntaryPayments: Number(inputs.voluntaryPayments || 0)
  };

  const r = cantonRules.ipv || {};
  const ref = r.ref_premium_annual || { adult: 6025.20, young_adult_education: 2116.80, child: 1114.80 };
  const selfRet = r.self_retention_rate ?? 0.46; 
  const limits = r.income_limits || {};
  const basicDed = r.basic_deduction || {};
  const perChildDed = basicDed.per_child || 2000;
  const minSub = r.minimum_reduction?.min_subsidy_chf ?? 0;

  // --- 2. 计算 LNA (Massgebendes Einkommen) ---
  // AR州公式：纯收入 + 15%资产 + 房产开支 + 3a等扣除项回归
  const assetAddition = 0.15 * safeInputs.taxableAssets;
  let pillar3aAdjusted = safeInputs.pillar3a;
  if (!safeInputs.hasVocationalPension) {
    pillar3aAdjusted = Math.max(0, pillar3aAdjusted - 10000);
  }

  const lna = safeInputs.taxableIncomeAnnual 
            + assetAddition 
            + safeInputs.propertyExpenses 
            + pillar3aAdjusted 
            + safeInputs.vocationalPurchases 
            + safeInputs.previousLosses 
            + safeInputs.simplifiedIncomes 
            + safeInputs.partyContributions 
            + safeInputs.voluntaryPayments;

  const totalChildren = safeInputs.numChildren + safeInputs.numYoungAdults;
  const isCouple = safeInputs.numAdults >= 2;

  // --- 3. 资格检查 (上限检查) ---
  let maxInc;
  if (!isCouple) {
    if (totalChildren === 0) maxInc = limits.single_without_children ?? 35000;
    else if (totalChildren === 1) maxInc = limits.single_with_1_child ?? 46200;
    else if (totalChildren === 2) maxInc = limits.single_with_2_children ?? 47000;
    else if (totalChildren === 3) maxInc = limits.single_with_3_children ?? 50400;
    else if (totalChildren === 4) maxInc = limits.single_with_4_children ?? 56700;
    else maxInc = limits.single_with_5_plus_children ?? 63000;
  } else {
    if (totalChildren === 0) maxInc = limits.couple_without_children ?? 55000;
    else if (totalChildren === 1) maxInc = limits.couple_with_1_child ?? 68200;
    else if (totalChildren === 2) maxInc = limits.couple_with_2_children ?? 75900;
    else if (totalChildren === 3) maxInc = limits.couple_with_3_children ?? 76000;
    else if (totalChildren === 4) maxInc = limits.couple_with_4_children ?? 77000;
    else maxInc = limits.couple_with_5_plus_children ?? 81000;
  }

  if (lna > maxInc) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [
          { label: 'Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` },
          { label: 'Einkommenslimite für Kanton AR', value: `${Math.round(maxInc)} CHF` }
        ],
        note: 'ipv_note_no_entitlement_income_exceeded'
      }
    };
  }

  // --- 4. 详细计算步骤 ---
  
  // 基础扣除
  let baseDed = 0;
  if (totalChildren === 0 && !isCouple) {
    baseDed = basicDed.single_without_children ?? 20670;
  } else {
    baseDed = basicDed.couple_or_single_with_children ?? 31005;
  }
  const childDedTotal = totalChildren * perChildDed;
  const totalDed = baseDed + childDedTotal;

  // 参考保费
  const refTotal = (safeInputs.numAdults * ref.adult) + 
                   (safeInputs.numYoungAdults * ref.young_adult_education) + 
                   (safeInputs.numChildren * ref.child);

  // 自付额
  const retained = Math.max(0, lna - totalDed);
  const selfAmt = retained * selfRet;

  // 最终补贴
  const theoretical = Math.max(0, refTotal - selfAmt);
  const final = Math.max(theoretical, minSub);
  const annualBenefit = Math.min(Math.round(final), safeInputs.annualHealthPremium);

  // --- 5. 返回极其详细的数据结构 ---
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    // 供 PDF 或详情页显示的所有原始数据
    details: {
      lna: Math.round(lna),
      assetAddition: Math.round(assetAddition),
      totalDeduction: Math.round(totalDed),
      refPremium: Math.round(refTotal),
      selfRetention: Math.round(selfAmt),
      maxIncomeLimit: maxInc
    },
    explanation: {
      steps: [
        { label: '1. Steuerbares Einkommen (Basis)', value: `${Math.round(safeInputs.taxableIncomeAnnual)} CHF` },
        { label: '2. Vermögensanteil (15%)', value: `${Math.round(assetAddition)} CHF` },
        { label: '3. Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` },
        { label: '4. Sozialabzug (Basis & Kinder)', value: `– ${Math.round(totalDed)} CHF` },
        { label: '5. Anrechenbare Einkommensdifferenz', value: `${Math.round(retained)} CHF` },
        { label: '6. Selbstbehalt (46% der Differenz)', value: `– ${Math.round(selfAmt)} CHF` },
        { label: '7. Gesamte Referenzprämien', value: `${Math.round(refTotal)} CHF` },
        { label: '8. Berechneter Anspruch (Theorie)', value: `${Math.round(theoretical)} CHF` },
        { label: '9. Definitive IPV (Max. Krankenkassenprämien)', value: `${annualBenefit} CHF` }
      ],
      note: 'AR_ipv_formula_note'
    },
    error: null
  };
}