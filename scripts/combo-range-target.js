// 사정거리(range)·대상(target) 캐노니컬 값 + 조합 자동조정 파서
// - 저장 값은 한글 캐노니컬 문자열(기존 컴펜디움 데이터와 일치, 마이그레이션 최소화).
// - 레거시 자유텍스트/오타/파라미터형(Xm, N체)을 normalize로 캐노니컬화.
// - 조합 규칙: 사정거리·대상 모두 "가장 제한적인(순위 최소) 컴포넌트"를 따라간다.
//   자신(self)은 자신끼리만 조합 가능 — 위반 시 경고만(진행 허용).
// - 효과참조/미지정('-')은 순위 없음(자동계산 제외) → 사용자가 직접 최종값을 정한다.
(function() {
  // ===== 캐노니컬 정의 =====
  // rank: 작을수록 제한적(조합 시 우선). null=자동계산 제외. parametric=숫자 파라미터 동반.
  const RANGE_DEFS = [
    { value: '-',      key: null,             rank: null },
    { value: '지근',   key: 'DX3rd.Engage',   rank: 10 },
    { value: '거리',   key: 'DX3rd.Distance', rank: 20, parametric: 'm' },   // 실제 저장값은 "{n}m"
    { value: '시야',   key: 'DX3rd.Sight',    rank: 30 },
    { value: '씬',     key: 'DX3rd.SceneTarget', rank: 40 },
    { value: '무기',   key: 'DX3rd.Weapon',   rank: null, special: 'weapon' },
    { value: '효과참조', key: 'DX3rd.Reference', rank: null, special: 'reference' }
  ];

  const TARGET_DEFS = [
    { value: '-',        key: null,               rank: null },
    { value: '자신',     key: 'DX3rd.Self',       rank: 0, self: true },
    { value: '단독',     key: 'DX3rd.Single',     rank: 10 },
    { value: '대상수',   key: 'DX3rd.TargetCount', rank: 12, parametric: '체' }, // 실제 저장값은 "{n}체"
    { value: '레벨대상수', key: 'DX3rd.LevelTargetCount', rank: 12, parametric: 'LV' }, // 실제 저장값은 "[LV+n]체"
    { value: '범위(선택)', key: 'DX3rd.AreaSelect', rank: 30 },
    { value: '범위',     key: 'DX3rd.Area',       rank: 40 },
    { value: '씬(선택)', key: 'DX3rd.SceneSelect', rank: 50 },
    { value: '씬',       key: 'DX3rd.SceneTarget', rank: 60 },
    { value: '효과참조', key: 'DX3rd.Reference',   rank: null, special: 'reference' }
  ];

  // 레거시/오타/동의어 → 캐노니컬 (파라미터형은 별도 정규식)
  const RANGE_SYNONYMS = {
    '지극': '지근', '근접': '지근',
    '야': '시야',
    '장면': '씬',
    '사정거리': '-', '': '-'
  };
  const TARGET_SYNONYMS = {
    '단일': '단독', '1체': '단독',
    '장면': '씬',
    '대상': '-', '': '-'
  };

  function localizeLabel(def) {
    if (!def.key) return def.value;
    const s = game?.i18n?.localize?.(def.key);
    return (s && s !== def.key) ? s : def.value;
  }

  // ===== 정규화 =====
  function normalizeRange(raw) {
    const v = String(raw ?? '').trim();
    if (v in RANGE_SYNONYMS) return RANGE_SYNONYMS[v];
    // "20m" / "20M" / bare number(=미터) → "{n}m"
    const m = v.match(/^(\d+)\s*m$/i) || v.match(/^(\d+)$/);
    if (m) return `${parseInt(m[1], 10)}m`;
    return v; // 이미 캐노니컬이거나 미지(기타)
  }

  function normalizeTarget(raw) {
    const v = String(raw ?? '').trim();
    if (v in TARGET_SYNONYMS) return TARGET_SYNONYMS[v];
    // 레벨 스케일 대상수: "[LV+1]체" / "LV+1" / "LV+1체" → "[LV+n]체"
    const lv = v.match(/\[?\s*LV\s*\+\s*(\d+)\s*\]?\s*체?$/i);
    if (lv) return `[LV+${parseInt(lv[1], 10)}]체`;
    // 고정 대상수: "3" / "3체" → "{n}체"
    const cnt = v.match(/^(\d+)\s*체?$/);
    if (cnt) return `${parseInt(cnt[1], 10)}체`;
    return v;
  }

  // ===== 순위 산출 =====
  // 반환: { rank:number|null, meters?:number, count?:number, self?:boolean, special?:string, value:string }
  function rangeInfo(raw) {
    const value = normalizeRange(raw);
    const mm = value.match(/^(\d+)m$/i);
    if (mm) return { rank: 20, meters: parseInt(mm[1], 10), value };
    const def = RANGE_DEFS.find(d => d.value === value);
    if (def) return { rank: def.rank, special: def.special, value };
    return { rank: null, value }; // 기타(미지)
  }

  function targetInfo(raw) {
    const value = normalizeTarget(raw);
    const cm = value.match(/^(\d+)체$/);
    if (cm) return { rank: 10, count: parseInt(cm[1], 10), value };
    if (/^\[LV\+\d+\]체$/i.test(value)) return { rank: 12, value };
    const def = TARGET_DEFS.find(d => d.value === value);
    if (def) return { rank: def.rank, self: !!def.self, special: def.special, value };
    return { rank: null, value }; // 기타(미지)
  }

  // 두 info 비교: a가 더 제한적(작음)이면 음수. rank 동률이면 meters/count 작은 쪽이 제한적.
  function moreRestrictive(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const am = a.meters ?? a.count ?? 0;
    const bm = b.meters ?? b.count ?? 0;
    return am - bm;
  }

  // ===== 조합 =====
  // 여러 컴포넌트의 사정거리를 합성. rankable(순위 있음)만 비교해 가장 제한적인 값 채택.
  // 반환: { value:string, resolved:boolean }  resolved=false면 자동 결정 불가(사용자 값 보존).
  function combineRange(rawList) {
    const infos = (rawList || []).map(rangeInfo).filter(i => i.rank !== null);
    if (infos.length === 0) return { value: '-', resolved: false };
    let best = infos[0];
    for (const info of infos.slice(1)) if (moreRestrictive(info, best) < 0) best = info;
    return { value: best.value, resolved: true };
  }

  // 대상 합성. 자신 규칙: 자신끼리면 자신, 자신+비자신 혼합이면 selfConflict=true(경고) 후 비자신 최소값.
  // 반환: { value:string, resolved:boolean, selfConflict:boolean }
  function combineTarget(rawList) {
    const infos = (rawList || []).map(targetInfo).filter(i => i.rank !== null);
    if (infos.length === 0) return { value: '-', resolved: false, selfConflict: false };

    const selfs = infos.filter(i => i.self);
    const nonSelf = infos.filter(i => !i.self);

    if (nonSelf.length === 0) return { value: '자신', resolved: true, selfConflict: false };

    let best = nonSelf[0];
    for (const info of nonSelf.slice(1)) if (moreRestrictive(info, best) < 0) best = info;
    return { value: best.value, resolved: true, selfConflict: selfs.length > 0 };
  }

  // ===== 시트 드롭다운용 분류 =====
  // 저장값 → { option, param }. option은 select에서 선택할 캐노니컬 옵션 value, param은 거리/대상수 숫자부.
  function classifyRange(raw) {
    const value = normalizeRange(raw);
    if (/^\d+m$/i.test(value)) return { option: '거리', param: value.replace(/m$/i, '') };
    if (RANGE_DEFS.some(d => d.value === value)) return { option: value, param: '' };
    if (value === '' || value === '-') return { option: '-', param: '' };
    return { option: '기타', param: value };
  }

  function classifyTarget(raw) {
    const value = normalizeTarget(raw);
    if (/^\d+체$/.test(value)) return { option: '대상수', param: value.replace(/체$/, '') };
    const lv = value.match(/^\[LV\+(\d+)\]체$/i);
    if (lv) return { option: '레벨대상수', param: lv[1] };
    if (TARGET_DEFS.some(d => d.value === value)) return { option: value, param: '' };
    if (value === '' || value === '-') return { option: '-', param: '' };
    return { option: '기타', param: value };
  }

  // select 옵션 목록(로케일 라벨 포함). '거리'/'대상수'/'기타'는 파라미터 입력을 동반.
  function rangeOptions() {
    return RANGE_DEFS.map(d => ({ value: d.value, label: localizeLabel(d), parametric: d.parametric || null }));
  }
  function targetOptions() {
    return TARGET_DEFS.map(d => ({ value: d.value, label: localizeLabel(d), parametric: d.parametric || null }));
  }

  // ===== 난이도(difficulty) =====
  // roll(판정 발동: major/reaction/dodge)과는 독립적인 목표치/유형 메타데이터.
  // 실제 컴펜디움 값: 자동성공 / 대결 / 효과참조 / 숫자 / '-'.
  //  - 자동성공: 판정 없이 성공
  //  - 대결: 대결 판정(상대 판정치와 비교)
  //  - 효과참조: 텍스트 참조(유저 수동)
  //  - 숫자: 고정 목표치
  const L = (k, fb) => { const s = game?.i18n?.localize?.(k); return (s && s !== k) ? s : fb; };

  const DIFFICULTY_OPTIONS = [
    { value: '-', label: '-' },
    { value: '자동성공', label: 'DX3rd.Freepass' },
    { value: '대결', label: 'DX3rd.Competition' },
    { value: '효과참조', label: 'DX3rd.Reference' },
    { value: '숫자', label: 'DX3rd.Number', parametric: true }
  ];

  function difficultyOptions() {
    return DIFFICULTY_OPTIONS.map(o => ({
      value: o.value,
      label: o.label.startsWith('DX3rd.') ? L(o.label, o.value) : o.label,
      parametric: o.parametric || null
    }));
  }

  function classifyDifficulty(raw) {
    const v = String(raw ?? '').trim();
    if (v === '' || v === '-') return { option: '-', param: '' };
    if (/^\d+$/.test(v)) return { option: '숫자', param: v };
    if (v === '자동성공' || v === '대결' || v === '효과참조') return { option: v, param: '' };
    return { option: '기타', param: v };
  }

  // 조합 난이도 합성(룰북 p.13 「난이도의 변경」):
  //  - 대결 이 하나라도 있으면 자동적으로 대결.
  //  - 그 외에는 가장 높은(엄격한) 숫자 난이도를 적용.
  //  - 자동성공 과 비자동성공(숫자/대결)이 섞이면 비자동성공을 적용(자동성공은 배제).
  //  - 효과참조/기타/미지정('-')만 있으면 자동 결정 불가(사용자 값 보존).
  // 우선순위(높을수록 채택): 대결 > 숫자(최댓값) > 자동성공.
  // 반환: { value:string, resolved:boolean }  resolved=false면 사용자 값 보존.
  function combineDifficulty(rawList) {
    const cls = (rawList || []).map(classifyDifficulty);
    if (cls.some(c => c.option === '대결')) return { value: '대결', resolved: true };
    const nums = cls.filter(c => c.option === '숫자').map(c => parseInt(c.param, 10)).filter(n => !isNaN(n));
    if (nums.length > 0) return { value: String(Math.max(...nums)), resolved: true };
    if (cls.some(c => c.option === '자동성공')) return { value: '자동성공', resolved: true };
    return { value: '-', resolved: false };
  }

  // 사정거리 값이 「무기」 특수 지시자인지(조합 시 무기 사정거리를 대입).
  function isWeaponRange(raw) {
    return normalizeRange(raw) === '무기';
  }

  function difficultyFieldContext(rawValue) {
    const cls = classifyDifficulty(rawValue);
    return {
      kind: 'difficulty',
      option: cls.option,
      param: cls.param,
      showParam: isParamOption('difficulty', cls.option),
      paramPlaceholder: L('DX3rd.Difficulty', '난이도'),
      options: difficultyOptions()
    };
  }

  // ===== 시트(드롭다운) 배선 헬퍼 =====
  // 템플릿에 넘길 필드 컨텍스트: 옵션 목록 + 초기 선택 + 파라미터 표시 여부.
  function fieldContext(kind, rawValue) {
    const isRange = kind === 'range';
    const cls = isRange ? classifyRange(rawValue) : classifyTarget(rawValue);
    return {
      kind,
      option: cls.option,
      param: cls.param,
      showParam: isParamOption(kind, cls.option),
      paramPlaceholder: isRange ? 'm' : (game?.i18n?.localize?.('DX3rd.Amount') || ''),
      options: isRange ? rangeOptions() : targetOptions()
    };
  }

  // kind별 파라미터 입력을 여는 옵션값(+ '기타'는 공통). target은 대상수/레벨대상수 둘 다 숫자 입력을 동반.
  const PARAM_OPTIONS = { range: ['거리'], target: ['대상수', '레벨대상수'], difficulty: ['숫자'] };
  function isParamOption(kind, option) {
    return option === '기타' || (PARAM_OPTIONS[kind] || []).includes(option);
  }

  // 드롭다운 선택 + 파라미터 입력 → 저장할 캐노니컬 값 조합.
  function composeValue(kind, option, param) {
    const p = String(param ?? '').trim();
    if (!option || option === '-') return '-';
    if (option === '기타') return p || '-';
    if (kind === 'range') {
      if (option === '거리') return p ? `${/^\d+$/.test(p) ? parseInt(p, 10) : p}m` : '-';
      return option;
    }
    if (kind === 'target') {
      if (option === '대상수') return p ? (/^\d+$/.test(p) ? `${parseInt(p, 10)}체` : p) : '-';
      if (option === '레벨대상수') return p ? (/^\d+$/.test(p) ? `[LV+${parseInt(p, 10)}]체` : p) : '-';
      return option;
    }
    // difficulty
    if (option === '숫자') return p ? (/^\d+$/.test(p) ? String(parseInt(p, 10)) : p) : '-';
    return option; // 자동성공 / 대결 / 효과참조
  }

  // .rt-field[data-rt] (select.rt-option + input.rt-param + input[type=hidden][name=system.range|target]) 배선.
  // update(item, {'system.range': value}) 콜백으로 즉시 저장.
  function setupFieldListeners(root, item, { update } = {}) {
    if (!root || !update) return;
    root.querySelectorAll('.rt-field[data-rt]').forEach(field => {
      const kind = field.dataset.rt;
      const sel = field.querySelector('.rt-option');
      const param = field.querySelector('.rt-param');
      const hidden = field.querySelector('input[type="hidden"]');
      if (!sel || !hidden) return;
      const apply = async () => {
        const show = isParamOption(kind, sel.value);
        if (param) param.style.display = show ? '' : 'none';
        const value = composeValue(kind, sel.value, param ? param.value : '');
        hidden.value = value;
        try { await update(item, { [`system.${kind}`]: value }); }
        catch (e) { console.error('DX3rd | RangeTarget field update failed', e); }
      };
      sel.addEventListener('change', apply);
      if (param) {
        param.addEventListener('change', apply);
        param.addEventListener('blur', apply);
      }
    });
  }

  window.DX3rdRangeTarget = {
    normalizeRange, normalizeTarget,
    rangeInfo, targetInfo,
    combineRange, combineTarget,
    classifyRange, classifyTarget,
    rangeOptions, targetOptions,
    difficultyOptions, classifyDifficulty, difficultyFieldContext, combineDifficulty,
    isWeaponRange,
    fieldContext, composeValue, setupFieldListeners,
    RANGE_DEFS, TARGET_DEFS
  };
})();
