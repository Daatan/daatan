/**
 * Rules-direction regression set (#1813), taken from the #1802 audit of 236 live forecasts.
 * `expected` is the audit verdict: `inverted` means the rules resolve YES on the opposite
 * of the claim. The consistent negated claims are the ones a fix must not break.
 * Used by scripts/check-rules-direction.ts.
 */
export interface RulesDirectionCase {
  id: string
  claim: string
  rules: string
  expected: 'consistent' | 'inverted' | 'unclear'
}

export const RULES_DIRECTION_CASES: RulesDirectionCase[] = [
  {
    id: "keren-peles-will-write-israels-song-for-eurovision-2027",
    expected: "inverted",
    claim: "Keren Peles will write Israel's song for Eurovision 2027.",
    rules: "The market will resolve to 'Yes' if official announcements from the European Broadcasting Union (EBU), the Israeli Public Broadcasting Corporation (Kan), or reliable media outlets confirm that Keren Peles did not write the song for Eurovision 2027. The market will resolve to 'No' if official announcements or reliable media outlets confirm that she did write the song, or was among its writers. If no conclusive information is available by the resolution date, the market will resolve to 50/50.",
  },
  {
    id: "a-sovereign-and-internationally-recognized-palestinian-state",
    expected: "inverted",
    claim: "A sovereign and internationally recognized Palestinian state will not be officially established by June 1, 2027.",
    rules: "The forecast will resolve as 'Yes' if, by June 1, 2027, a sovereign and internationally recognized Palestinian state, with defined borders and a functioning government, is officially established, with the approval of key international bodies such as the UN. Otherwise, the forecast will resolve as 'No'.",
  },
  {
    id: "itamar-ben-gvir-will-not-reserve-a-spot-for-idit-silman-on-t",
    expected: "inverted",
    claim: "Itamar Ben-Gvir will not reserve a spot for Idit Silman on the Otzma Yehudit party list by December 31, 2026.",
    rules: "The question will resolve positively if Itamar Ben-Gvir officially reserves a spot for Idit Silman on the Otzma Yehudit party list, as confirmed by official party statements, documents submitted to the Election Committee, or reports in major Israeli media outlets (e.g., Ynet, Haaretz, Jerusalem Post). The question will resolve negatively if such a reservation is not made by the resolution date.",
  },
  {
    id: "there-will-be-no-missile-strikes-launched-from-iranian-terri",
    expected: "inverted",
    claim: "There will be no missile strikes launched from Iranian territory against Israel, nor from Israeli territory against Iran, during May 2026.",
    rules: "Resolved as 'Yes' if any credible report from major international news agencies (e.g., Reuters, AP, AFP) confirms a missile strike launched from Iranian territory against Israel, or from Israeli territory against Iran, during May 2026. Resolved as 'No' otherwise.",
  },
  {
    id: "a-ceasefire-lasting-longer-than-one-week-will-not-be-impleme",
    expected: "inverted",
    claim: "A ceasefire lasting longer than one week will not be implemented in the conflict between Russia and Ukraine by December 31, 2026.",
    rules: "Resolved as YES if official reports from reputable international organizations (e.g., UN, OSCE) or major news agencies (e.g., Reuters, AP, BBC) confirm a continuous cessation of hostilities between Russian and Ukrainian forces for a period exceeding seven consecutive days, observed across the entire front line, before December 31, 2026. Otherwise, resolved as NO.",
  },
  {
    id: "the-united-states-will-not-conduct-a-military-strike-against",
    expected: "inverted",
    claim: "The United States will not conduct a military strike against Iran by February 22, 2026.",
    rules: "Resolved as 'Yes' if official US government sources, or major reputable news agencies (e.g., Reuters, AP, BBC, New York Times) report that the United States military has conducted an overt military strike against targets within Iran's sovereign territory. Covert operations or cyberattacks do not count. Resolved as 'No' otherwise.",
  },
  {
    id: "the-israeli-citizenship-of-yuval-abraham-and-rachel-shorr-cr",
    expected: "consistent",
    claim: "The Israeli citizenship of Yuval Abraham and Rachel Shorr, creators of the film \"NAZA\", will not be revoked by December 31, 2027.",
    rules: "This forecast will resolve as 'Yes' if the Israeli citizenship of Yuval Abraham and Rachel Shorr is not officially revoked by the Government of Israel by December 31, 2027. This forecast will resolve as 'No' if the Israeli citizenship of Yuval Abraham or Rachel Shorr is officially revoked by the Government of Israel by December 31, 2027.",
  },
  {
    id: "am-yisrael-will-not-pass-the-electoral-threshold-in-the-next",
    expected: "consistent",
    claim: "Am Yisrael will not pass the electoral threshold in the next general elections for the Knesset by December 31, 2026.",
    rules: "This forecast will resolve as 'Yes' if the Am Yisrael party does not pass the official electoral threshold in the next general elections in Israel, as confirmed by the Central Elections Committee. It will resolve as 'No' if the Am Yisrael party passes the electoral threshold.",
  },
  {
    id: "narendra-modi-will-not-be-the-prime-minister-of-india-by-dec",
    expected: "consistent",
    claim: "Narendra Modi will not be the Prime Minister of India by December 31, 2028.",
    rules: "This prediction will resolve as 'True' if Narendra Modi is not serving as the Prime Minister of India at any point on December 31, 2028, as confirmed by official Indian government announcements or major reputable news outlets (e.g., Reuters, AP, BBC). Otherwise, it will resolve as 'False'.",
  },
  {
    id: "in-the-next-knesset-elections-no-single-party-will-receive-m",
    expected: "consistent",
    claim: "In the next Knesset elections, no single party will receive more than 25 seats.",
    rules: "The resolution will be based on the official results published by the Central Elections Committee for the next Knesset elections. If no single party receives more than 25 seats, the claim will be affirmed. Otherwise, the claim will be rejected.",
  },
  {
    id: "the-blue-and-white-party-led-by-benny-gantz-will-announce-by",
    expected: "consistent",
    claim: "The Blue and White party, led by Benny Gantz, will announce by the end of August 2026 that it will not run in the next elections as an independent party.",
    rules: "The resolution will be based on an official announcement from Benny Gantz or the Blue and White party, or a reliable report in major Israeli media outlets (such as Ynet, Walla, Haaretz) confirming such an announcement.",
  },
  {
    id: "a-single-large-political-list-will-not-be-formed-including-a",
    expected: "consistent",
    claim: "A single large political list will not be formed, including at least four of the following six politicians: Benny Gantz, Yoaz Hendel, Hili Tropper, Ayelet Shaked, Yuli Edelstein, and Gilaad Erdan, by the final deadline for submitting candidate lists for the next general elections in Israel, expected to take place by December 31, 2026.",
    rules: "The question will resolve as 'Yes' if, by the final deadline for submitting candidate lists for the next general elections in Israel, no official candidate list is submitted to the Central Elections Committee that includes at least four of the following six politicians: Benny Gantz, Yoaz Hendel, Hili Tropper, Ayelet Shaked, Yuli Edelstein, and Gilaad Erdan. Otherwise, the question will resolve as 'No'.",
  },
  {
    id: "yoaz-hendel-will-run-in-the-26th-knesset-elections-as-part-o",
    expected: "consistent",
    claim: "Yoaz Hendel will run in the 26th Knesset elections as part of a party he leads or founded, and will not join another existing list.",
    rules: "This prediction will resolve as 'Yes' if Yoaz Hendel officially registers a new political party or leads a newly formed party that runs in the 26th Knesset elections, and does not appear on the official list of candidates for any pre-existing political party. It will resolve as 'No' if he joins an existing party's list or does not run at all.",
  },
  {
    id: "the-next-israeli-government-will-not-include-any-arab-minist",
    expected: "consistent",
    claim: "The next Israeli government will not include any Arab ministers by December 31, 2026.",
    rules: "Resolved based on official announcements or reliable media reports (e.g., AP, Reuters) confirming the composition of the next Israeli government and the ministerial appointments. If any individual identified as an Arab minister is appointed to a cabinet position, the claim resolves as 'No'. Otherwise, it resolves as 'Yes'.",
  },
  {
    id: "iron-maiden-will-perform-a-concert-in-romania-that-is-not-ca",
    expected: "consistent",
    claim: "Iron Maiden will perform a concert in Romania that is not canceled, by December 31, 2026.",
    rules: "Resolved YES if Iron Maiden officially announces and performs a concert in Romania by the resolution date, and the concert is not subsequently canceled. Resolved NO if no such concert is announced or performed, or if it is announced but then canceled.",
  },
  {
    id: "vladimir-putin-will-not-be-the-president-of-russia-by-may-8-",
    expected: "consistent",
    claim: "Vladimir Putin will not be the President of Russia by May 8, 2027.",
    rules: "Resolved by official announcements from the Russian government or major international news agencies (e.g., Reuters, AP, BBC) confirming Vladimir Putin is no longer the acting President of Russia.",
  },
  {
    id: "the-amcha-yisrael-party-led-by-ofer-winter-will-pass-the-ele",
    expected: "consistent",
    claim: "The 'Amcha Yisrael' party, led by Ofer Winter, will pass the electoral threshold in the 26th Knesset elections.",
    rules: "The forecast will resolve as 'Yes' if the 'Amcha Yisrael' list receives at least 3.25% of all valid votes in the 26th Knesset elections, according to the official results of the Central Elections Committee.",
  },
  {
    id: "the-voter-turnout-in-the-upcoming-knesset-elections-will-rea",
    expected: "consistent",
    claim: "The voter turnout in the upcoming Knesset elections will reach at least 73%.",
    rules: "The resolution will be determined by the official voter turnout percentage published by Israel's Central Elections Committee for the Knesset elections to be held on October 27, 2026. If the reported voter turnout is 73% or higher, the claim will be affirmed; otherwise, it will be rejected.",
  },
  {
    id: "donald-trump-will-be-elected-for-a-third-term-as-president-o",
    expected: "consistent",
    claim: "Donald Trump will be elected for a third term as President of the United States by November 7, 2028.",
    rules: "This market will resolve to 'Yes' if Donald Trump is officially declared the winner of the 2028 US presidential election by the Associated Press (AP), Reuters, or other major and reliable news outlets. This market will resolve to 'No' if he is not declared the winner.",
  },
  {
    id: "the-film-naza-will-be-officially-shown-in-sinematec-or-anoth",
    expected: "consistent",
    claim: "The film NAZA will be officially shown in Cinematheque or another large cinema by December 31, 2026.",
    rules: "Resolved YES if official announcements or reliable media reports confirm that the film 'NAZA' has been publicly screened in Sinematec or any other large commercial cinema by the resolution date. Resolved NO otherwise.",
  },
  {
    id: "the-number-of-immigrants-to-israel-will-exceed-25000-in-the-",
    expected: "consistent",
    claim: "The number of immigrants to Israel will exceed 25,000 in the year 5787.",
    rules: "The forecast will be resolved as positive if official data published by the Ministry of Aliyah and Integration and/or the Jewish Agency, or the Central Bureau of Statistics (CBS), indicates that the number of new immigrants to Israel in the Hebrew year 5787 (approximately between September 2026 and September 2027) exceeds 25,000. The forecast will be resolved as negative if the number is 25,000 or less.",
  },
  {
    id: "cultivated-meat-will-comprise-more-than-50-of-global-meat-co",
    expected: "consistent",
    claim: "Cultivated meat will comprise more than 50% of global meat consumption by weight by December 31, 2056.",
    rules: "This prediction will resolve YES if official data from a reputable international food organization (e.g., FAO, USDA, or equivalent) confirms that cultivated meat constitutes over 50% of the total global meat consumption by weight by the resolution date. Otherwise, it resolves NO.",
  },
  {
    id: "the-voting-percentage-of-haredi-jews-will-be-higher-than-tha",
    expected: "unclear",
    claim: "The voting percentage of Haredi Jews will be higher than that of non-Haredi Jews in the Israeli elections on October 27, 2026.",
    rules: "Resolved based on official election data and demographic analysis from a reputable Israeli polling organization or government statistical agency (e.g., Central Bureau of Statistics) that specifically reports voter turnout by Haredi and non-Haredi Jewish populations. If such data is not publicly available or cannot be reliably determined, the market will resolve as N/A.",
  },
  {
    id: "the-us-will-officially-recognise-somaliland-by-the-end-of-20",
    expected: "unclear",
    claim: "The US will officially recognise Somaliland by the end of 2027",
    rules: "official US position",
  },
]
