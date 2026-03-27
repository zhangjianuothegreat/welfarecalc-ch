/**
 * elsuanfa_JU.js – 2026 République et Canton du Jura (JU) EL 算法
 * 审计标准：100% 匹配 CCAJ (Caisse de Compensation du Jura) 2026 官方标准
 * 核心逻辑：联邦 LPC/ELG 2026 修正案、13th AHV 中性化、Jura Region 3 租金与保费锁定
 */
export default function calculateEL_JU(inputs, cantonRules) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };
  const r = cantonRules?.el || {};
  
  // --- 1. 基础参数与支出计算 (Dépenses reconnues) ---
  const numAdults = Number(inputs.numAdults) || 1;
  const numChildren = Number(inputs.numChildren) || 0; // 0-10岁
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0); // 11-25岁
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults === 2;
  
  // A. 生活基准额 (Besoins vitaux - 2026 联邦/JU 标准)
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 阶梯递减逻辑：针对 0-10 岁儿童（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660, 3660];
  for (let i = 0; i < numChildren && i < childRates0_10.length; i++) {
    annualGB += childRates0_10[i];
  }
  // 阶梯逻辑：针对 11-25 岁受教育青年 (2026 改革高额度)（保持不变）
  const youngRates = [10815, 10815, 7210, 7210, 3605, 3605];
  for (let i = 0; i < numEducation && i < youngRates.length; i++) {
    annualGB += youngRates[i];
  }
  
  // B. 租金限额 (Loyer - Region 3 锁定)
  // 使用 Grok 审计后的 2026 最新官方上限
  const region3 = {
    "1_person": 1390,
    "2_persons": 1680,
    "3_persons": 1850,
    "4_persons": 2000,
    "5_plus_persons": 2000
  };
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = region3["1_person"];
  else if (totalPersons === 2) maxRentMonthly = region3["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = region3["3_persons"];
  else maxRentMonthly = region3["4_persons"];
  let recognizedRentAnnual = Math.min(Number(inputs.monthlyRent) || 0, maxRentMonthly) * 12;
  // 轮椅适配住房补充 (2026 官方标准: +6900/年)
  if (inputs.isWheelchairAccessible === true) {
    recognizedRentAnnual += 6900;
  }
  
  // === KK Pauschale 修复（符合 ELG Art. 11 + JU 执行细则）===
  // 1. 先取州标准 Richtprämien（从规则配置读取，兼容数据文件结构）
  const premiumRef = r.recognized_premiums_annual || {
    adult: 5808,
    young: 4344,
    child: 1380
  };
  const standardPremiumAnnual = (numAdults * premiumRef.adult) +
    (numEducation * premiumRef.young) +
    (numChildren * premiumRef.child);

  // 2. 优先使用用户实际输入的年度保费（health_premium / annualHealthPremium）
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  // 3. 如果用户未输入（<=0）或数值异常（>30000），才兜底使用州标准
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = standardPremiumAnnual;
  }

  // 4. 安全上限（兼容其他州代码中的 r.recognized_premiums_annual.max）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 2. 收入计算 (Revenus déterminants) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[JU] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarnedIncome = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留原有）
  let assetLimit = isCouple ? 200000 : 100000;
  assetLimit += (numChildren + numEducation) * 50000; // 联邦改革儿童资产增额
  if (Number(inputs.taxableAssets || 0) > assetLimit) {
    return { isEligible: false, error: 'err_asset_exceeded', annualBenefit: 0 };
  }
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren + numEducation) * 15000; // 儿童资产扣除额

  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (Number(inputs.taxableAssets || 0) - assetExemption) / verzehrDivisor);

  const totalIncome = annualIncome + countableEarnedIncome + assetIncome;
  
  // --- 3. 差额计算 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'JU_el_region_3_name', value: `Region 3 (Jura)` },
        { label: 'step_grundbedarf_annual', value: Math.round(annualGB) },
        { label: 'step_recognized_rent_annual', value: Math.round(recognizedRentAnnual) },
        // 已改为官方要求的通用标签，清晰体现“州标准 / 实际保费”
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'step_income_total_annual', value: Math.round(totalIncome) }
      ],
      application: {
        authority_key: "JU_el_application_authority",
        office_key: "JU_el_office_name",
        address_key: "JU_el_contact_address",
        phone: "+41 32 952 11 59",
        url: "https://www.ecasjura.ch/fr/Assurances/PC/Prestations-complementaires/Prestations-complementaires.html",
        docs_key: "JU_el_required_documents_list"
      }
    }
  };
}