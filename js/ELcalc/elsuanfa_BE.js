// elsuanfa_BE.js – 2026 伯尔尼州 (BE) EL 算法 [修复版, 与官方一致]
export default function calculateEL_BE(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖）===
  const GRUNDBEDARF_2026 = {
    single: 20670,
    couple: 31005
  };

  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }

  const r = cantonRules?.el || {};

  // 邮编匹配（Bern 默认 Region 2）
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 2; // Bern 城市默认 Region 2
  let foundPLZ = false;

  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    regionNumber = allPostalData[userPLZ].EL_REGION || 2;
    foundPLZ = true;
  }

  const regionKey = `region_${regionNumber}`;

  const rentLimits = r.rent_limits_annual?.[regionKey] || r.rent_limits_annual?.region_2 || null;
  let premiumKey = regionNumber === 1 ? "region1_high" : (regionNumber === 2 ? "region2_medium" : "region3_low");
  const premiumData = r.recognized_premiums_annual?.[premiumKey] || null;

  if (!rentLimits || !premiumData) {
    return { error: 'err_no_region_data', annualBenefit: 0 };
  }

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

  const assetLimit = isCouple ? 200000 : 100000;
  if (safeInputs.taxableAssets > assetLimit) {
    return { error: 'err_asset_exceeded_federal', annualBenefit: 0 };
  }

  // 支出计算
  let annualBasic = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  let childGB = 0;
  for (let i = 0; i < safeInputs.numChildren; i++) {
    childGB += childRates0_10[Math.min(i, 4)];
  }

  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < safeInputs.numYoungAdults; i++) {
    childGB += childRates11_25[Math.min(i, 4)];
  }

  annualBasic += childGB;

  // 租金 - 修正键名匹配
  let personKey = totalPersons === 1 ? '1_person' :
                  (totalPersons === 2 ? '2_persons' :
                  (totalPersons === 3 ? '3_persons' :
                  (totalPersons === 4 ? '4_persons' : '5_plus_persons')));
  const maxMonthlyRent = rentLimits[personKey] || 0;
  const recognizedMonthlyRent = Math.min(safeInputs.monthlyRent, maxMonthlyRent);
  const recognizedRentAnnual = recognizedMonthlyRent * 12;

  // KK 保费
  let annualPremium = Number(inputs.health_premium || 0);
  if (annualPremium <= 0 || annualPremium > 30000) {
    annualPremium = (safeInputs.numAdults * premiumData.adult) +
                    (safeInputs.numYoungAdults * premiumData.young_adult) +
                    (safeInputs.numChildren * premiumData.child);
  }
  annualPremium = Math.min(annualPremium, 30000);

  const totalAnnualNeeds = annualBasic + recognizedRentAnnual + annualPremium;

  // 收入处理
  let annualIncome = Number(safeInputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(safeInputs.regularAnnualPension ||
                               safeInputs.annualPension ||
                               (safeInputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[BE] Pension: monthly=${safeInputs.monthlyPensionAmount}, regularAnnual=${safeInputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (safeInputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  const earnedIncome = Number(safeInputs.earnedIncomeAnnual || 0);
  let annualEarnedIncome = earnedIncome * 0.8; // BE 扣20%

  let exemption = isCouple ? 60000 : 37500;
  exemption += (safeInputs.numChildren + safeInputs.numYoungAdults) * 15000;
  const excessAssets = Math.max(0, safeInputs.taxableAssets - exemption);
  const verzehrDivisor = (safeInputs.isReceivingPension === 'iv') ? 15 : 10;
  const annualAssetIncome = excessAssets / verzehrDivisor;

  const totalAnnualIncome = annualIncome + annualEarnedIncome + annualAssetIncome;

  // EL 计算
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalAnnualIncome);
  const monthlyBenefit = Math.round(annualBenefit / 12);

  const noteText = foundPLZ ? 'Offizielle Region' : 'Standard Region 2 (Bern)';

  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit,
    isEligible: annualBenefit > 0,
    error: annualBenefit <= 0 ? 'err_no_entitlement' : null,
    explanation: {
      steps: [
        { label: 'EL-Region', value: `Region ${regionNumber}` },
        { label: 'Lebensbedarf (inkl. Kinder)', value: Math.round(annualBasic) },
        { label: 'Anerkannter Mietzins', value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Prämien', value: Math.round(annualPremium) },
        { label: 'Total Ausgaben (jährlich)', value: Math.round(totalAnnualNeeds) },
        { label: 'Anrechenbares Einkommen (jährlich)', value: Math.round(totalAnnualIncome) },
        { label: 'Jährlicher EL-Anspruch', value: Math.round(annualBenefit) }
      ],
      note: noteText
    }
  };
}