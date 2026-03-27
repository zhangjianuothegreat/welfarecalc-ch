// 汝拉州 IPV（Jura）2026年官方算法 - 用户友好版
export default function calculateIPV_JU(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { annualBenefit: 0, monthlyBenefit: 0, explanation: { note: 'Ungültige Eingabedaten.' } };
  }
  // 必填字段校验
  const req = ['numAdults', 'numChildren', 'numEducation', 'taxableIncomeAnnual', 'taxableAssets', 'annualHealthPremium'];
  for (const f of req) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0) {
      return { annualBenefit: 0, monthlyBenefit: 0, explanation: { note: `Ungültiges oder fehlendes Feld: ${f}` } };
    }
  }
  if (inputs.numAdults < 1 || inputs.numAdults > 10) {
    return { annualBenefit: 0, monthlyBenefit: 0, explanation: { note: 'Anzahl Erwachsene muss zwischen 1 und 10 liegen.' } };
  }
  const r = cantonRules.ipv || {};
  const ref = r.full_subsidy_reference_monthly || { adult: 568.30, young_adult: 391.80, child: 125.00 };
  const childBonusMonthly = r.child_bonus_monthly || { child: 100, young_adult_in_training_under_25: 196 };
  const familySupplementMonthly = r.family_supplement_monthly_per_parent || { min: 15, max: 300 };
  const incomeLimits = r.income_limits || {
    adult_rdu_max: 26999,
    family_children_young_adults_rdu_max: 52999,
    family_supplement_rdu_max: 18000
  };
  const assetLimit = r.asset_limit_single || 150000;
  const minSubsidy = (r.minimum_reduction && r.minimum_reduction.min_subsidy_chf) || 120;
  const tiers = r.income_subsidy_tiers || [];
  // LNA 计算
  const maintenanceContributions = inputs.maintenanceContributions || 0;
  let lna = inputs.taxableIncomeAnnual + 0.05 * inputs.taxableAssets - maintenanceContributions;
  if (lna < 0) lna = 0;
  const hasChildren = inputs.numChildren + inputs.numEducation > 0;
  // 资产超限
  if (inputs.taxableAssets > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'Massgebendes Vermögen', value: `${inputs.taxableAssets.toLocaleString('de-CH')} CHF` },
          { label: 'Vermögensgrenze', value: `${assetLimit.toLocaleString('de-CH')} CHF` }
        ],
        note: 'Leider kein Anspruch: Das steuerbare Vermögen überschreitet die Grenze von 150\'000 CHF.'
      }
    };
  }
  // 收入超限
  const maxLna = hasChildren ? incomeLimits.family_children_young_adults_rdu_max : incomeLimits.adult_rdu_max;
  if (lna > maxLna) {
    const limitText = hasChildren ? 'Familien mit Kindern/Jugendlichen' : 'Einzelpersonen';
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: '1. Massgebendes Einkommen (LNA)', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'Grenze für ' + limitText, value: `${maxLna.toLocaleString('de-CH')} CHF` }
        ],
        note: `Leider kein Anspruch: Ihr massgebendes Einkommen überschreitet die Grenze von ${maxLna.toLocaleString('de-CH')} CHF für ${limitText}.`
      }
    };
  }
  // 正常计算（有资格）
  const refTotal = inputs.numAdults * ref.adult * 12 +
                   inputs.numEducation * ref.young_adult * 12 +
                   inputs.numChildren * ref.child * 12;
  let baseSubsidy = 0;
  for (const t of tiers) {
    if (lna <= t.lna_max) {
      baseSubsidy = t.subsidy_amount || 0;
      break;
    }
  }
  const childBonus = inputs.numChildren * childBonusMonthly.child * 12 +
                     inputs.numEducation * childBonusMonthly.young_adult_in_training_under_25 * 12;
  let familySupplement = 0;
  if (hasChildren && lna < incomeLimits.family_supplement_rdu_max) {
    const supplementPerParentMonthly = familySupplementMonthly.max -
      (lna / incomeLimits.family_supplement_rdu_max) *
      (familySupplementMonthly.max - familySupplementMonthly.min);
    familySupplement = inputs.numAdults * supplementPerParentMonthly * 12;
  }
  const calculatedSubsidy = baseSubsidy + childBonus + familySupplement;
  let annualBenefit = Math.min(calculatedSubsidy, inputs.annualHealthPremium);
  if (annualBenefit > 0 && hasChildren) {
    annualBenefit = Math.max(minSubsidy, annualBenefit);
  }
  annualBenefit = Math.round(annualBenefit);

  // 修改note逻辑，使用键名
  let noteKey = '';
  if (annualBenefit > 0) {
    noteKey = hasChildren ? 'ipv_note_eligible_with_children' : 'ipv_note_eligible_general';
  } else {
    noteKey = hasChildren ? 'ipv_note_no_entitlement_with_children' : 'ipv_note_no_entitlement_without_children';
  }
  const note = r[noteKey] || ''; // 从规则中取键值，如果未定义为空

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    explanation: {
      steps: [
        { label: '1. Massgebendes Einkommen (LNA)', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: '2. Grundsubvention', value: `${Math.round(baseSubsidy).toLocaleString('de-CH')} CHF` },
        { label: '3. Kinderbonus', value: `${Math.round(childBonus).toLocaleString('de-CH')} CHF` },
        { label: '4. Familienzuschlag', value: `${Math.round(familySupplement).toLocaleString('de-CH')} CHF` },
        { label: '5. Finale Prämienverbilligung', value: `${annualBenefit.toLocaleString('de-CH')} CHF/Jahr` }
      ],
      note: note
    },
    error: null
  };
}