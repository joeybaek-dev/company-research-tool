// generate-listed.js
// 실행: node generate-listed.js
// 결과: corps-listed.json 생성 (상장사 업종/지역 포함)

const https = require("https");
const fs = require("fs");

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";

// KSIC 업종코드 → 업종명 매핑 (index.html의 IND_MAP과 동일하게 유지)
const IND_MAP = {
  "01":"농업","02":"임업","03":"어업","05":"석탄광업","06":"원유천연가스","07":"금속광업","08":"비금속광물",
  "10":"식품제조","11":"음료제조","12":"담배제조","13":"섬유제품","14":"의복모피","15":"가죽가방신발",
  "16":"목재나무","17":"펄프종이","18":"인쇄기록","19":"코크스연탄","20":"화학물질",
  "21":"의약품","22":"고무플라스틱","23":"비금속광물제품","24":"1차금속","25":"금속가공",
  "26":"전자부품컴퓨터","27":"의료정밀광학","28":"전기장비","29":"기타기계장비","30":"자동차트레일러",
  "31":"기타운송장비","32":"가구제조","33":"기타제조","35":"전기가스증기","36":"수도업",
  "37":"하수처리","38":"폐기물처리","39":"환경정화복원","41":"건물건설","42":"토목건설",
  "43":"전문직별공사","45":"자동차판매","46":"도매","47":"소매","49":"육상운송",
  "50":"수상운송","51":"항공운송","52":"창고운송서비스","53":"우편통신",
  "55":"숙박업","56":"음식점","58":"출판영상방송","59":"영상오디오제작",
  "60":"방송업","61":"통신업","62":"컴퓨터프로그래밍","63":"정보서비스",
  "64":"금융업","65":"보험업","66":"금융보조","68":"부동산업",
  "70":"연구개발업","71":"전문서비스","72":"건축기술","73":"과학기술서비스",
  "74":"사업지원서비스","75":"공공행정","76":"교육서비스","86":"보건업","87":"사회복지",
  "90":"창작예술","91":"스포츠오락","94":"협회단체","95":"개인서비스",
  "582":"소프트웨어개발","5822":"게임소프트웨어",
};

// induty_code로 업종명 변환 (긴 코드부터 순서대로 매칭)
function getIndNm(code) {
  if (!code || code === "-") return "-";
  return IND_MAP[code]
    || IND_MAP[code.slice(0, 4)]
    || IND_MAP[code.slice(0, 3)]
    || IND_MAP[code.slice(0, 2)]
    || "-";
}

function dartGet(corp_code) {
  return new Promise((resolve, reject) => {
    const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!fs.existsSync("corps.json")) {
    console.error("❌ corps.json 파일이 없어요. 먼저 generate-corps.js를 실행해주세요.");
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync("corps.json", "utf8"));
  const listed = all.filter(c => c.listed);
  console.log(`📋 상장사 ${listed.length.toLocaleString()}개 상세정보 수집 시작`);
  console.log(`⏱️  예상 소요시간: 약 ${Math.ceil(listed.length / 10)}분`);

  const results = [];
  const BATCH = 10;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < listed.length; i += BATCH) {
    const batch = listed.slice(i, i + BATCH);
    const batchRes = await Promise.all(batch.map(async c => {
      const detail = await dartGet(c.corp_code);
      if (!detail || detail.status !== "000") { failed++; return null; }

      const industryCode = detail.induty_code || "";
      const industryNm = getIndNm(industryCode); // ← 핵심 수정: induty_code로 업종명 변환

      return {
        id: c.corp_code,
        corp_code: c.corp_code,
        name: c.corp_name || c.name,
        listed: true,
        stock_code: c.stock_code || "",
        industry_nm: industryNm,           // ← 변환된 업종명
        industry_code: industryCode,        // ← 원본 코드도 보존
        region: detail.adres ? detail.adres.slice(0, 2) : "-",
        founded: detail.est_dt ? detail.est_dt.slice(0, 4) : "-",
        employees: parseInt((detail.emp_no || "").replace(/,/g, "")) || null, // ← 쉼표 제거 후 파싱
        homepage: detail.hm_url || "",
      };
    }));

    results.push(...batchRes.filter(Boolean));
    done += batch.length;

    if (done % 100 === 0 || done === listed.length) {
      const pct = ((done / listed.length) * 100).toFixed(0);
      process.stdout.write(`\r  진행: ${done}/${listed.length} (${pct}%) | 성공: ${results.length} | 실패: ${failed}`);
    }

    await sleep(100);
  }

  console.log(`\n✅ 수집 완료! ${results.length}개 성공, ${failed}개 실패`);

  // 업종별 통계
  const indMap = {};
  results.forEach(c => {
    const ind = c.industry_nm !== "-" ? c.industry_nm : "미분류";
    indMap[ind] = (indMap[ind] || 0) + 1;
  });
  const topInds = Object.entries(indMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\n📊 상위 업종:");
  topInds.forEach(([ind, cnt]) => console.log(`  ${ind}: ${cnt}개`));

  fs.writeFileSync("corps-listed.json", JSON.stringify(results));
  const size = fs.statSync("corps-listed.json").size;
  console.log(`\n💾 corps-listed.json 저장 완료 (${(size / 1024).toFixed(0)}KB)`);
  console.log("🎉 완료! corps-listed.json을 서버 루트에 업로드해주세요.");
}

main().catch(console.error);