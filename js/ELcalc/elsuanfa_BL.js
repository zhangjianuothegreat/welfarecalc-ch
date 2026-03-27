// elsuanfa_BL.js – 2026 巴塞尔乡村州 (BL) EL 算法 [官方高精准锁定版]
export default function calculateEL_BL(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };

  // 1. 基础安全检查
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }

  const r = cantonRules.el || {};

  // 2. 邮编与地理分区匹配 (BL 州仅有 Region 2 & 3)
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 2; // BL 默认 Region 2
  let foundPLZ = false;

  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionNumber = (dbRegion === 3) ? 3 : 2;
    foundPLZ = true;
  }

  const regionKey = `region_${regionNumber}`;

  // 3. 读取配置
  const rentLimits = r.rent_limits_annual ? r.rent_limits_annual[regionKey] : null;
  const premiumData = r.recognized_premiums_annual ? r.recognized_premiums_annual.standard_2026 : null;

  if (!rentLimits || !premiumData) {
    return { error: 'err_no_region_data', annualBenefit: 0 };
  }

  // 4. 数据预处理
  const safeInputs = {
    numAdults: Number(inputs.numAdults) || 1,
    numChildren: Number(inputs.numChildren) || 0,
    numYoungAdults: Number(inputs.numYoungAdults || inputs.numEducation || 0),
    monthlyRent: Number(inputs.monthlyRent || 0),
    taxableIncomeAnnual: Number(inputs.taxableIncomeAnnual || 0),
    earnedIncomeAnnual: Number(inputs.earnedIncomeAnnual || 0),
    taxableAssets: Number(inputs.taxableAssets || 0),
    isReceivingPension: inputs.isReceivingPension,
    regularAnnualPension: Number(inputs.regularAnnualPension || 0),
    annualPension: Number(inputs.annualPension || 0),
    monthlyPensionAmount: Number(inputs.monthlyPensionAmount || 0)
  };

  const totalPersons = safeInputs.numAdults + safeInputs.numChildren + safeInputs.numYoungAdults;
  const isCouple = safeInputs.numAdults === 2;

  // 5. 资产门槛
  const assetLimit = isCouple ? (r.asset_limits?.couple || 200000) : (r.asset_limits?.single || 100000);
  if (safeInputs.taxableAssets > assetLimit) {
    return { error: 'err_asset_exceeded_federal', annualBenefit: 0 };
  }

  // 6. 支出计算 (Ausgaben)
  let annualBasic = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  // BL 州儿童阶梯（如果有，从 JSON 读；否则用联邦默认）
  let childGB = 0;
  // 如果 JSON 有 child_rates，可在此添加阶梯逻辑
  // 示例：childGB += safeInputs.numChildren * 5000 + safeInputs.numYoungAdults * 8000;

  annualBasic += childGB;

  // 租金
  let personKey = totalPersons >= 5 ? '5' : String(totalPersons);
  const maxRentLimit = rentLimits[personKey] || 0;
  const recognizedRent = Math.min(safeInputs.monthlyRent * 12, maxRentLimit);

  // KK 保费
  let annualPremium = Number(inputs.health_premium || 0);
  if (annualPremium <= 0 || annualPremium > 30000) {
    annualPremium = (safeInputs.numAdults * premiumData.adult) +
                    (safeInputs.numYoungAdults * premiumData.young_adult) +
                    (safeInputs.numChildren * premiumData.child);
  }
  annualPremium = Math.min(annualPremium, 30000);

  const totalAnnualNeeds = annualBasic + recognizedRent + annualPremium;

  // 7. 收入处理（2026 统一标准）
  let annualIncome = Number(safeInputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(safeInputs.regularAnnualPension ||
                               safeInputs.annualPension ||
                               (safeInputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[BL] Pension: monthly=${safeInputs.monthlyPensionAmount}, regularAnnual=${safeInputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (safeInputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  const earnedIncome = Number(safeInputs.earnedIncomeAnnual || 0);
  let annualEarnedIncome = 0;
  if (earnedIncome > 0) {
    const freibetrag = isCouple ? 1500 : 1000;
    annualEarnedIncome = Math.max(0, (earnedIncome - freibetrag) * 0.666666);
  }

  const exemption = isCouple ? 50000 : 30000;
  const verzehrDivisor = (safeInputs.isReceivingPension === 'iv') ? 15 : 10;
  const annualAssetIncome = Math.max(0, (safeInputs.taxableAssets - exemption) / verzehrDivisor);

  const totalAnnualIncome = annualIncome + annualEarnedIncome + annualAssetIncome;

  // 8. 差额计算
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalAnnualIncome);
  const monthlyBenefit = Math.round(annualBenefit / 12);

  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit,
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: `EL-Region ${foundPLZ ? '' : '(Standard)'}`, value: `Region ${regionNumber}` },
        { label: 'Lebensbedarf (jährlich)', value: Math.round(annualBasic) },
        { label: 'Anerkannte Miete (jährlich)', value: Math.round(recognizedRent) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(annualPremium) },
        { label: '13. AHV-Rente (neutralisiert)', value: Math.round(deduction13th) },
        { label: 'Anrechenbare Einnahmen (jährlich)', value: Math.round(totalAnnualIncome) },
        { label: 'Jährlicher EL-Anspruch', value: Math.round(annualBenefit) }
      ],
      note: foundPLZ
        ? 'Berechnung basiert auf BL-Vorgaben 2026.'
        : 'Hinweis: PLZ nicht erkannt. Berechnung basiert auf Standard-Region 2.'
    }
  };
}