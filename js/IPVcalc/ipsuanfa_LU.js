// 卢塞恩州 IPV（Luzern）2026年官方算法 - 修复版
export default function calculateIPV_LU(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };

  const req = ['numAdults', 'numChildren', 'numEducation', 'netIncomeAnnual', 'taxableAssets', 'annualHealthPremium'];
  for (const f of req) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0) {
      return { error: `Ungültiges Feld: ${f}`, annualBenefit: 0 };
    }
  }
  if (inputs.numAdults < 1 || inputs.numAdults > 10) return { error: 'Anzahl Erwachsene 1-10', annualBenefit: 0 };

  // === 关键修复：支持数字或字符串的 premiumRegion，并默认 region_2 ===
  let regionKey = 'region_2'; // 安全默认（中值）
  if (inputs.premiumRegion) {
    if (typeof inputs.premiumRegion === 'number' && [1,2,3].includes(inputs.premiumRegion)) {
      regionKey = 'region_' + inputs.premiumRegion;
    } else if (typeof inputs.premiumRegion === 'string' && ['region_1','region_2','region_3'].includes(inputs.premiumRegion)) {
      regionKey = inputs.premiumRegion;
    }
  } else if (inputs.region && ['region_1','region_2','region_3'].includes(inputs.region)) {
    // 兼容旧字段
    regionKey = inputs.region;
  }

  const r = cantonRules.ipv || {};
  const refRegions = r.ref_premium_annual_by_region || {};
  const refObj = refRegions[regionKey] || refRegions.region_2 || { adult: 5628, young_adult: 4044, child: 1308 };
  const ref = {
    adult: refObj.adult || 5628,
    young_adult: refObj.young_adult || 4044,
    child: refObj.child || 1308
  };

  const brackets = r.subsidy_brackets || [
    { income_max: 30000, rate: 0.8 },
    { income_max: 50000, rate: 0.7 },
    { income_max: 70000, rate: 0.55 },
    { income_max: 90000, rate: 0.4 },
    { income_max: 110000, rate: 0.25 },
    { income_max: 130000, rate: 0.1 },
    { income_max: Infinity, rate: 0 }
  ];
  const assetLimitSingle = r.asset_limit_single || 100000;
  const assetLimitCouple = r.asset_limit_couple || 200000;
  const minRed = r.minimum_reduction || { children: 0.8, young_adults_in_education: 0.5, min_subsidy_chf: 100 };
  const incomeLimitsFixed = r.income_limits_for_fixed_child_young_adult_subsidy || { couple: 96392, single_parent: 77114 };

  // LNA 计算
  const assetAddition = 0.1 * (inputs.taxableAssets || 0);
  const lna = inputs.netIncomeAnnual + assetAddition;

  // 资产上限
  const isCouple = inputs.numAdults === 2;
  const assetLimit = isCouple ? assetLimitCouple : assetLimitSingle;
  if (inputs.taxableAssets > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: '1. Steuerbares Vermögen', value: `${inputs.taxableAssets.toLocaleString('de-CH')} CHF` },
          { label: 'Vermögensgrenze', value: `${assetLimit.toLocaleString('de-CH')} CHF` }
        ],
        note: 'Leider kein Anspruch: Das Vermögen überschreitet die kantonale Grenze.'
      }
    };
  }

  const refTotal = inputs.numAdults * ref.adult + inputs.numEducation * ref.young_adult + inputs.numChildren * ref.child;

  let rate = 0;
  for (const b of brackets) {
    if (lna <= b.income_max) {
      rate = b.rate;
      break;
    }
  }

  let calculatedSubsidy = refTotal * rate;

  // Mindestgarantie
  let minGuarantee = 0;
  const hasChildren = inputs.numChildren + inputs.numEducation > 0;
  const incomeThreshold = isCouple ? incomeLimitsFixed.couple : incomeLimitsFixed.single_parent;
  if (hasChildren && lna <= incomeThreshold) {
    minGuarantee += inputs.numChildren * ref.child * minRed.children;
    minGuarantee += inputs.numEducation * ref.young_adult * minRed.young_adults_in_education;
  }
  calculatedSubsidy = Math.max(calculatedSubsidy, minGuarantee);

  let annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium);
  const finalBenefit = annualBenefit > 0 ? Math.max(minRed.min_subsidy_chf, annualBenefit) : 0;

  return {
    annualBenefit: finalBenefit,
    monthlyBenefit: Math.round(finalBenefit / 12),
    calculatedSubsidy: Math.round(calculatedSubsidy),
    actualSubsidy: finalBenefit,
    determiningIncome: Math.round(lna),
    totalRefPremium: Math.round(refTotal),
    subsidyRate: `${(rate * 100).toFixed(0)}%`,
    appliedTier: rate > 0 ? `Einkommensstufe bis ${Math.round(lna)} CHF` : 'Kein Anspruch',
    explanation: {
      steps: [
        { label: '1. LNA (massgebendes Einkommen)', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: '2. Gesamte Referenzprämie', value: `${Math.round(refTotal).toLocaleString('de-CH')} CHF` },
        { label: '3. Subventionssatz', value: `${(rate * 100).toFixed(0)}%` },
        { label: '4. Berechneter Subventionsbetrag', value: `${Math.round(calculatedSubsidy).toLocaleString('de-CH')} CHF` },
        { label: '5. Finale IPV (begrenzt auf effektive Prämie)', value: `${finalBenefit.toLocaleString('de-CH')} CHF` }
      ],
      note: 'Luzern Progressives Prozent-Modell 2026'
    },
    cantonRule: r,
    error: null
  };
}