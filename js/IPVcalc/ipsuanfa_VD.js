// Vaud州 IPV – 2026年最终修正版（兼容 main.js inputs，无需额外字段）
export default function calculateIPV_VD(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  }

  // 从 main.js 常见字段回退赋值（兼容性修复）
  const numAdults = Number(inputs.numAdults) || 1;
  const numChildren = Number(inputs.numChildren) || 0;
  const numEducation = Number(inputs.numEducation) || 0;
  const netIncomeAnnual = Number(inputs.income) || Number(inputs.netIncomeAnnual) || 0; // income 即净收入
  const taxableAssets = Number(inputs.assets) || Number(inputs.taxableAssets) || 0;
  const annualHealthPremium = Number(inputs.health_premium) || Number(inputs.annualHealthPremium) || 0;
  
  // region：如果 main.js 未传，从 PLZ 推导（这里简化默认 region_2，实际应调用 postal_data）
  let region = inputs.region || 'region_2'; // 默认乡村区（较低保费），生产环境应从 PLZ 映射

  const r = cantonRules.ipv || {};

  // 参考保费（2026年沃州官方平均值）
  const refPremiumByRegion = r.ref_premium_annual_by_region || { region_1: 6520, region_2: 6110 };
  const refPremiumPerPerson = refPremiumByRegion[region] || 6110; // 回退值

  // 免税额（官方标准）
  const exemptions = r.exemption_amounts || { single: 56000, couple: 112000, per_child: 15000 };

  // 资产限额（官方 2026 值）
  const assetLimitSingle = r.asset_limit_single || 100000;
  const assetLimitCouple = r.asset_limit_couple || 160000;

  // 渐进补贴阶层（官方 RDU 模型）
  const tiers = r.rdu_subsidy_tiers || [
    { rdu_max: 20000, rate: 0.9 },
    { rdu_max: 35000, rate: 0.75 },
    { rdu_max: 50000, rate: 0.55 },
    { rdu_max: 65000, rate: 0.35 },
    { rdu_max: 80000, rate: 0.15 },
    { rdu_max: Infinity, rate: 0 }
  ];

  // 最低保障比例
  const minRed = r.minimum_reduction || { children: 0.8, young_adults_in_education: 0.5 };

  // socialDeductions 默认 0（官方自动处理，用户无需填）
  const socialDeductions = Number(inputs.socialDeductions) || 0;

  // 资产超限直接无资格（官方硬性规定）
  const isCouple = numAdults >= 2;
  const assetLimit = isCouple ? assetLimitCouple : assetLimitSingle;
  if (taxableAssets > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [],
        note: 'ipv_note_no_entitlement_assets_exceeded'
      },
      error: null
    };
  }

  const assetExcess = Math.max(0, taxableAssets - assetLimit);
  const assetAddition = 0.05 * assetExcess; // 超额部分 5% 计入收入

  // LNA（massgebendes Einkommen）
  const lna = netIncomeAnnual + assetAddition - socialDeductions;

  // RDU（减免税额）
  const baseExemption = isCouple ? exemptions.couple : exemptions.single;
  const childExemption = (numChildren + numEducation) * exemptions.per_child;
  const rdu = Math.max(0, lna - baseExemption - childExemption);

  // 补贴比例
  let rate = 0;
  for (const t of tiers) {
    if (rdu <= t.rdu_max) {
      rate = t.rate;
      break;
    }
  }

  // 家庭总参考保费
  const totalHouseholdMembers = numAdults + numChildren + numEducation;
  const totalRefPremium = refPremiumPerPerson * totalHouseholdMembers;

  // 初步补贴
  let calculatedSubsidy = totalRefPremium * rate;

  // 儿童/青年最低保障
  let minGuarantee = 0;
  minGuarantee += numChildren * refPremiumPerPerson * minRed.children;
  minGuarantee += numEducation * refPremiumPerPerson * minRed.young_adults_in_education;

  // 取较高值
  const enhancedSubsidy = Math.max(calculatedSubsidy, minGuarantee);

  // 最终补贴：不超过实际保费
  const annualBenefit = Math.min(Math.round(enhancedSubsidy), annualHealthPremium);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    totalRefPremium: Math.round(totalRefPremium),
    calculatedSubsidy: Math.round(calculatedSubsidy),
    minGuarantee: Math.round(minGuarantee),
    enhancedSubsidy: Math.round(enhancedSubsidy),
    determiningIncome: Math.round(lna),
    rdu: Math.round(rdu),
    subsidyRate: `${(rate * 100).toFixed(0)}%`,
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: '1. Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` },
        { label: '2. Revenu déterminant unifié (RDU)', value: `${Math.round(rdu)} CHF` },
        { label: '3. Subventionsquote', value: `${(rate * 100).toFixed(0)}%` },
        { label: '4. Total Referenzprämie (Haushalt)', value: `${Math.round(totalRefPremium)} CHF` },
        { label: '5. Theoretische Subvention', value: `${Math.round(calculatedSubsidy)} CHF` },
        { label: '6. Nach Mindestgarantie', value: `${Math.round(enhancedSubsidy)} CHF` },
        { label: '7. Finale Subvention (max. effektive Prämie)', value: `${annualBenefit} CHF` }
      ],
      note: 'Vaud 2026: Progressives RDU-Modell mit Zielbelastung von ca. 10% und Mindestgarantien für Kinder/Jugendliche.'
    },
    error: null
  };
}