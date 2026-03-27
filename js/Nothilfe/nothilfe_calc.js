// js/Nothilfe/nothilfe_calc.js
const t = window.t || function(key) { return key; };

export async function calculateNothilfe(formData, state) {
  console.log("t function available in Nothilfe?", typeof t === 'function');
  console.log("Available translation keys count:", Object.keys(window.LANG || {}).length);

  const dataPath = window.resolvePath
    ? window.resolvePath('data/nothilfe_amounts.json')   // 注意：你这里写的是 nothilfe/nothilfe_amounts.json
    : 'data/nothilfe/nothilfe_amounts.json';

  let data;
  try {
    const res = await fetch(dataPath);
    if (!res.ok) throw new Error('Nothilfe-Daten konnten nicht geladen werden');
    data = await res.json();
  } catch (e) {
    console.error("Nothilfe-Daten-Ladefehler:", e);
    return { eligible: false, error: 'nothilfe_data_load_failed' };
  }

  // 合并联邦默认值 + 州覆盖
  const federal = data.federal || {};
  const stateData = data.states[state] || data.states.default || {};

  const dailyCash        = stateData.daily_cash ?? federal.single_base ?? 9.0;
  const coupleFactor     = stateData.couple_factor ?? federal.couple_factor ?? 1.70;
  const childAddonFactor = stateData.child_addon_factor ?? federal.child_addon_factor ?? 0.55;
  const childFrom3Bonus  = stateData.child_from3_bonus_factor ?? federal.child_from3_bonus_factor ?? 0.0;

  const adults   = Math.max(1, formData.numAdults || 1);
  const children = (formData.numChildren || 0) + (formData.numEducation || 0);

  // 计算逻辑保持不变 ……
  let adultDaily = 0;
  if (adults === 1) {
    adultDaily = dailyCash;
  } else {
    adultDaily = dailyCash + (adults - 1) * dailyCash * coupleFactor;
  }

  let childDaily = 0;
  if (children > 0) {
    childDaily = children * dailyCash * childAddonFactor;
    if (children >= 3 && childFrom3Bonus > 0) {
      const extraChildren = children - 2;
      childDaily += extraChildren * dailyCash * childFrom3Bonus;
    }
  }

  const dailyTotal = adultDaily + childDaily;
  const monthly = Math.round(dailyTotal * 30.42);
  const annual  = Math.round(monthly * 12);

  // ──────────────── 关键修改在这里 ────────────────
  return {
    eligible: true,
    benefitType: "nothilfe",
    monthlyBenefit: monthly,
    annualBenefit: annual,
    monthly: monthly,
    annual: annual,
    breakdown: {
      adults,
      children,
      adultDaily,
      childDaily,
      totalDaily: dailyTotal
    },
    explanation: {
      steps: [
        { label: t('nothilfe_adults'), value: adults },
        { label: t('nothilfe_children_education'), value: children },
        { label: t('nothilfe_daily_adult_rate'), value: `${dailyCash.toFixed(2)} CHF` },
        { label: t('nothilfe_daily_child_addon'), value: `${(dailyCash * childAddonFactor).toFixed(2)} CHF pro Kind` },
        ...(children >= 3 && childFrom3Bonus > 0 ? [{
          label: t('nothilfe_from3_bonus'),
          value: `${(dailyCash * childFrom3Bonus).toFixed(2)} CHF ab 3. Kind`
        }] : []),
        { label: t('nothilfe_daily_total_cash'), value: `${dailyTotal.toFixed(2)} CHF` },
        { label: t('nothilfe_monthly_cash_estimated'), value: `${monthly} CHF` }
      ],
      note: t('nothilfe_note_realistic') + ' ' + t('nothilfe_note_2026')
    },
    // 新增：把联邦法律依据完整带到 meta 里
    meta: {
      state,
      note_key: 'nothilfe_note_realistic',
      legal_basis: federal.legal_basis   // ← 关键！直接使用 json 里的结构
    }
  };
}