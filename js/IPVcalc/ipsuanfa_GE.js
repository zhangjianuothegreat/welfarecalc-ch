// 修改后的完整 IPVsuanfa_GE.js
/**
 * Offizieller IPV-Algorithmus Kanton Genf (GE) 2026
 * Berechnet die Prämienverbilligung für die Krankenversicherung im Kanton Genf
 * @param {Object} inputs - Eingabedaten der Familie/Einzelperson
 * @param {number} inputs.numAdults - Anzahl der Erwachsenen im Haushalt
 * @param {number} [inputs.numChildren=0] - Anzahl der Kinder (unter 19)
 * @param {number} [inputs.numEducation=0] - Anzahl der Jugendlichen in Ausbildung (19-25)
 * @param {number} inputs.netIncomeAnnual - Jahresnettoeinkommen (steuerbares Einkommen)
 * @param {number} inputs.taxableAssets - Steuerbares Vermögen
 * @param {number} [inputs.alimonyPaid=0] - Zahlte Unterhaltsbeiträge
 * @param {number} inputs.annualHealthPremium - Jahreskrankenkassenprämie (gesamt)
 * @param {Object} cantonRules - Kantonspezifische Regeln und Parameter
 * @returns {Object} Berechnetes Ergebnis mit Vorteil, Monatsbetrag und Erläuterungen
 */
export default function calculateIPV_GE(inputs, cantonRules) {
    // Validierung der Eingabedaten
    if (!inputs || typeof inputs !== 'object') {
        return {
            error: 'Ungültige Daten',
            annualBenefit: 0
        };
    }
    // Extrahiere Genfer IPV-Regeln (FIX: cantonRules.ipv statt cantonRules.GE?.ipv)
    const r = cantonRules.ipv;
    if (!r) {
        return {
            error: 'Keine gültigen Genfer Regeln gefunden',
            annualBenefit: 0
        };
    }
    const groups = r.income_groups;
    // 1. Berechnung des RDU (Revenu déterminant unifié)
    const rdu = (inputs.netIncomeAnnual || 0) +
        ((inputs.taxableAssets || 0) * r.asset_consumption_rate) -
        (inputs.alimonyPaid || 0);
    // 2. Prüfung auf hohes Einkommen/Vermögen (Spezialfall: Belastung <=10% RDU)
    const isHighIncomeWealth = (inputs.netIncomeAnnual > r.high_income_threshold) || (inputs.taxableAssets > r.high_wealth_threshold);
    let steps = [
        { label: 'RDU (Determining Income)', value: `${Math.round(rdu)} CHF` }
    ];
    if (isHighIncomeWealth) {
        const theoretical = Math.max(0, inputs.annualHealthPremium - 0.1 * rdu);
        const annualBenefit = Math.min(Math.round(theoretical), inputs.annualHealthPremium || 0);
        steps.push(
            { label: 'Belastungssatz', value: '10% RDU' },
            { label: 'Subside total théorique', value: `${Math.round(theoretical)} CHF` }
        );
        return {
            annualBenefit,
            monthlyBenefit: Math.round(annualBenefit / 12),
            determiningIncome: Math.round(rdu),
            group: 'Spezialfall (hohes Einkommen/Vermögen)',
            explanation: {
                steps,
                note: 'Genève 2026: Spezialfall für hohes Bruttoeinkommen (>200\'000 CHF) oder Bruttvermögen (>250\'000 CHF) – Belastung <=10% RDU.'
            }
        };
    }
    // 3. Dynamische Schwellenwerte basierend auf Haushaltsgrösse (exakt nach offiziellem Barème)
    const isCouple = inputs.numAdults >= 2;
    const totalKids = (inputs.numChildren || 0) + (inputs.numEducation || 0);
    let thresholds = [];
    if (totalKids === 0) {
        // Keine Charges: Separate für Single/Couple, keine G9
        if (isCouple) {
            thresholds = [45000, 55000, 65000, 75000, 85000, 95000, 105000, 115000]; // G1-G8 max
        } else {
            thresholds = [30000, 35000, 37500, 40000, 42500, 45000, 47500, 50000]; // G1-G8 max
        }
    } else {
        // Mit Charges: Gleiche Schwellen für Single/Couple, mit G9
        const baseG1 = 30000 + 21000 + (totalKids - 1) * 6000; // Exakt: +21k first, +6k each additional
        thresholds = [baseG1];
        for (let i = 1; i < 7; i++) {
            thresholds.push(thresholds[i - 1] + 10000); // +10k für G2-G8
        }
        const g8Max = thresholds[7];
        thresholds.push(g8Max + 30000); // +30k für G9 max
    }
    // 4. Bestimmung der Subventionsgruppe (G1 - G9+)
    let groupIndex = -1;
    for (let i = 0; i < thresholds.length; i++) {
        if (rdu <= thresholds[i]) {
            groupIndex = i;
            break;
        }
    }
    if (groupIndex === -1) {
        // Über Grenze: Kein Anspruch
        steps.push(
            { label: 'Einkommensstufe', value: 'Über Grenze' },
            { label: r.ipv_final_ipv || 'Finale IPV', value: '0 CHF' }
        );
        return {
            annualBenefit: 0,
            monthlyBenefit: 0,
            determiningIncome: Math.round(rdu),
            explanation: {
                steps,
                note: r.ipv_note_no_entitlement_income || 'Leider kein Anspruch: Ihr massgebendes Einkommen überschreitet die kantonale Grenze.'
            },
            error: null
        };
    }
    const activeGroup = groups[groupIndex];
    // 5. Berechnung der Subventionsbeträge
    const annualAdult = activeGroup.adult_monthly * 12 * inputs.numAdults;
    const annualYoung = activeGroup.young_monthly * 12 * (inputs.numEducation || 0);
    const annualChild = activeGroup.child_monthly * 12 * (inputs.numChildren || 0);
    // Theoretischer Gesamtbetrag (kein Bonus, kein Min 53)
    let theoretical = annualAdult + annualYoung + annualChild;
    // Finale Prämienverbilligung (maximal die tatsächliche Prämie)
    const annualBenefit = Math.min(Math.round(theoretical), inputs.annualHealthPremium || 0);
    // Rückgabe des Ergebnisses mit detaillierten Erläuterungen
    steps.push(
        { label: 'Subside Adulte / mois', value: `${activeGroup.adult_monthly} CHF` },
        { label: 'Subside total théorique', value: `${Math.round(theoretical)} CHF` }
    );
    return {
        annualBenefit,
        monthlyBenefit: Math.round(annualBenefit / 12),
        determiningIncome: Math.round(rdu),
        // Geänderte Gruppenbezeichnung nach Vorschlag
        group: groupIndex === (groups.length - 1) && totalKids > 0
            ? "G9 (Minimum/Aide d'office)"
            : `G${groupIndex + 1}`,
        explanation: {
            steps,
            note: 'Genève 2026: Basierend auf RDU und Gruppenmodell (G1-G9).'
        }
    };
}