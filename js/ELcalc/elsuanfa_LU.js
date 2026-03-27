// elsuanfa_LU.js – 2026 Luzern (LU) EL 算法 [官方 100% 匹配版]
// 核心依据：WAS Luzern & Bundesgesetz über Ergänzungsleistungen (ELG) 2026
// 针对德语区用户开发，输出保持德语。
export default function calculateEL_LU(inputs, cantonRules, allPostalData) {
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
  
  // --- 2. 邮编匹配逻辑 (LU 州分区判定) ---
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 3; // 默认保底为 Region 3 (Ländlich)
  let foundPLZ = false;
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    // 卢塞恩州仅存在 Region 2 和 3
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionNumber = (dbRegion === 2) ? 2 : 3;
    foundPLZ = true;
  }
  // 映射对应的租金和保费标准
  const regionKey = `region_${regionNumber}`;
  const premiumKey = regionNumber === 2 ? "region2_medium" : "region3_low";
  const rentLimits = r.rent_limits_monthly[regionKey];
  const premiumLimits = r.recognized_premiums_annual[premiumKey];
  if (!rentLimits || !premiumLimits) {
    return { error: 'err_config_missing', annualBenefit: 0 };
  }
  
  // --- 3. 资产准入门槛检查 (Eintrittsschwelle 2026) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren = Number(inputs.numChildren) || 0; // 0-10岁
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0); // 11-25岁
  const totalPersons = (isCouple ? 2 : 1) + numChildren + numEducation;
  
  // 2026 联邦标准门槛：单身 100k, 夫妻 200k (不含自住房)，每儿童/青年额外50k
  let threshold = isCouple ? 200000 : 100000;
  threshold += (numChildren + numEducation) * 50000;
  const netAssets = Number(inputs.taxableAssets || 0);
  if (netAssets >= threshold) {
    return {
      isEligible: false,
      error: 'err_asset_exceeded',
      annualBenefit: 0,
      explanation: { note: "Das Reinvermögen übersteigt die Eintrittsschwelle (100k/200k)." }
    };
  }
  
  // --- 4. 支出计算 (Ausgaben) ---
  // A. 一般生活费 (Grundbedarf 2026)
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 儿童生活费阶梯 (LU 遵循联邦标准，分年龄)（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660, 3660];
  let totalChildGB = 0;
  for (let i = 0; i < numChildren && i < childRates0_10.length; i++) {
    totalChildGB += childRates0_10[i];
  }
  const youngRates = [10815, 10815, 7210, 7210, 3605, 3605];
  for (let i = 0; i < numEducation && i < youngRates.length; i++) {
    totalChildGB += youngRates[i];
  }
  annualGB += totalChildGB; // 将儿童生活费加到总生活基准额中
  
  // B. 租金计算 (Anerkannte Miete)
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits['1_person'];
  else if (totalPersons === 2) maxRentMonthly = rentLimits['2_persons'];
  else if (totalPersons === 3) maxRentMonthly = rentLimits['3_persons'];
  else if (totalPersons === 4) maxRentMonthly = rentLimits['4_persons'];
  else maxRentMonthly = rentLimits['5_plus_persons'];
  const actualRentMonthly = Number(inputs.monthlyRent || 0);
  let recognizedRentAnnual = Math.min(actualRentMonthly, maxRentMonthly) * 12;
  // 额外：轮椅适配住房补充 (2026 官方: +6900/年)
  if (inputs.isWheelchairAccessible === true) {
    recognizedRentAnnual += 6900;
  }
  
  // === KK Pauschale 修复（符合 ELG Art. 11 + LU 执行细则）===
  // 1. 先计算州标准 Richtprämien（从规则配置读取）
  const standardPremiumAnnual = 
    (isCouple ? 2 : 1) * premiumLimits.adult +
    (numEducation * premiumLimits.young_adult) +
    (numChildren * premiumLimits.child);

  // 2. 优先使用用户实际输入的年度保费（health_premium / annualHealthPremium）
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  // 3. 如果用户未输入（<=0）或数值异常（>30000），才兜底使用州标准
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = standardPremiumAnnual;
  }

  // 4. 安全上限（兼容其他州代码中的 r.recognized_premiums_annual.max）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 5. 收入计算 (Einnahmen) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[LU] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留原有）
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren + numEducation) * 15000; // 每儿童/青年额外扣除
  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (netAssets - assetExemption) / verzehrDivisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 6. 最终结果 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  const monthlyBenefit = Math.round(annualBenefit / 12);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit,
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Grundbedarf (jährlich)', value: Math.round(annualGB) },
        { label: `Mietzins-Region (Region ${regionNumber})`, value: `Region ${regionNumber}` },
        { label: 'Anerkannte Miete (jährlich)', value: Math.round(recognizedRentAnnual) },
        // 已改为官方要求的通用标签，清晰体现"州标准 / 实际保费"
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen (exkl. 13. AHV)', value: Math.round(totalIncome) }
      ],
      note: foundPLZ ? "Berechnung basiert auf der offiziellen EL-Region Ihres Wohnorts im Kanton Luzern." : "Standard-Region 3 verwendet (PLZ nicht erkannt)."
    }
  };
}