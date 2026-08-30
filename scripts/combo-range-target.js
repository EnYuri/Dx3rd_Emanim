// The canonical range / target values plus the parser that auto-adjusts them on combination
// - The stored value is the Korean canonical string (matching the existing compendium data, minimizing migration).
// - Legacy free text, typos and parametric forms (Xm, N체) are canonicalized by normalize.
// - The combination rule: both range and target follow the "most restrictive (lowest-ranked) component".
//   자신 (self) can only combine with itself — a violation only warns (it is allowed to proceed).
// - An effect reference / unstated ('-') has no rank (excluded from the automatic computation) → the user sets the final value.
(function() {
  // ===== The canonical definitions =====
  // rank: the lower, the more restrictive (it wins on combination). null = excluded from the automatic computation. parametric = it carries a numeric parameter.
  const RANGE_DEFS = [
    { value: '-',      key: null,             rank: null },
    { value: '지근',   key: 'DX3rd.Engage',   rank: 10 },
    { value: '거리',   key: 'DX3rd.Distance', rank: 20, parametric: 'm' },   // the value actually stored is "{n}m"
    { value: '시야',   key: 'DX3rd.Sight',    rank: 30 },
    { value: '씬',     key: 'DX3rd.SceneTarget', rank: 40 },
    { value: '무기',   key: 'DX3rd.Weapon',   rank: null, special: 'weapon' },
    { value: '효과참조', key: 'DX3rd.Reference', rank: null, special: 'reference' }
  ];

  const TARGET_DEFS = [
    { value: '-',        key: null,               rank: null },
    { value: '자신',     key: 'DX3rd.Self',       rank: 0, self: true },
    { value: '단독',     key: 'DX3rd.Single',     rank: 10 },
    { value: '대상수',   key: 'DX3rd.TargetCount', rank: 12, parametric: '체' }, // the value actually stored is "{n}체"
    { value: '레벨대상수', key: 'DX3rd.LevelTargetCount', rank: 12, parametric: 'LV' }, // the value actually stored is "[LV+n]체"
    { value: '범위(선택)', key: 'DX3rd.AreaSelect', rank: 30 },
    { value: '범위',     key: 'DX3rd.Area',       rank: 40 },
    { value: '씬(선택)', key: 'DX3rd.SceneSelect', rank: 50 },
    { value: '씬',       key: 'DX3rd.SceneTarget', rank: 60 },
    { value: '효과참조', key: 'DX3rd.Reference',   rank: null, special: 'reference' }
  ];

  // Legacy / typo / synonym → canonical (parametric forms have their own regexes)
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

  // ===== Normalization =====
  function normalizeRange(raw) {
    const v = String(raw ?? '').trim();
    if (v in RANGE_SYNONYMS) return RANGE_SYNONYMS[v];
    // "20m" / "20M" / a bare number (= meters) → "{n}m"
    const m = v.match(/^(\d+)\s*m$/i) || v.match(/^(\d+)$/);
    if (m) return `${parseInt(m[1], 10)}m`;
    return v; // already canonical, or unknown (other)
  }

  function normalizeTarget(raw) {
    const v = String(raw ?? '').trim();
    if (v in TARGET_SYNONYMS) return TARGET_SYNONYMS[v];
    // A level-scaled target count: "[LV+1]체" / "LV+1" / "LV+1체" → "[LV+n]체"
    const lv = v.match(/\[?\s*LV\s*\+\s*(\d+)\s*\]?\s*체?$/i);
    if (lv) return `[LV+${parseInt(lv[1], 10)}]체`;
    // A fixed target count: "3" / "3체" → "{n}체"
    const cnt = v.match(/^(\d+)\s*체?$/);
    if (cnt) return `${parseInt(cnt[1], 10)}체`;
    return v;
  }

  // ===== Deriving the rank =====
  // Returns: { rank:number|null, meters?:number, count?:number, self?:boolean, special?:string, value:string }
  function rangeInfo(raw) {
    const value = normalizeRange(raw);
    const mm = value.match(/^(\d+)m$/i);
    if (mm) return { rank: 20, meters: parseInt(mm[1], 10), value };
    const def = RANGE_DEFS.find(d => d.value === value);
    if (def) return { rank: def.rank, special: def.special, value };
    return { rank: null, value }; // other (unknown)
  }

  function targetInfo(raw) {
    const value = normalizeTarget(raw);
    const cm = value.match(/^(\d+)체$/);
    if (cm) return { rank: 10, count: parseInt(cm[1], 10), value };
    if (/^\[LV\+\d+\]체$/i.test(value)) return { rank: 12, value };
    const def = TARGET_DEFS.find(d => d.value === value);
    if (def) return { rank: def.rank, self: !!def.self, special: def.special, value };
    return { rank: null, value }; // other (unknown)
  }

  // Compare two infos: negative when a is more restrictive (smaller). On a rank tie, the smaller meters/count is more restrictive.
  function moreRestrictive(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const am = a.meters ?? a.count ?? 0;
    const bm = b.meters ?? b.count ?? 0;
    return am - bm;
  }

  // ===== Combination =====
  // Combine several components' ranges. Only rankable entries are compared, and the most restrictive value is taken.
  // Returns: { value:string, resolved:boolean } — resolved=false means it could not be decided automatically (the user's value is kept).
  function combineRange(rawList) {
    const infos = (rawList || []).map(rangeInfo).filter(i => i.rank !== null);
    if (infos.length === 0) return { value: '-', resolved: false };
    let best = infos[0];
    for (const info of infos.slice(1)) if (moreRestrictive(info, best) < 0) best = info;
    return { value: best.value, resolved: true };
  }

  // Combining targets. The self rule: self among selves stays self; a mix of self and non-self sets selfConflict=true (a warning) and then takes the non-self minimum.
  // Returns: { value:string, resolved:boolean, selfConflict:boolean }
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

  // ===== Classification for the sheet dropdowns =====
  // A stored value → { option, param }. option is the canonical option value to select in the select, param is the numeric part of the distance / target count.
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

  // The select option list (with localized labels). '거리' / '대상수' / '기타' carry a parameter input.
  function rangeOptions() {
    return RANGE_DEFS.map(d => ({ value: d.value, label: localizeLabel(d), parametric: d.parametric || null }));
  }
  function targetOptions() {
    return TARGET_DEFS.map(d => ({ value: d.value, label: localizeLabel(d), parametric: d.parametric || null }));
  }

  // ===== Difficulty =====
  // Target-value / kind metadata, independent of roll (the roll trigger: major/reaction/dodge).
  // The actual compendium values: 자동성공 (auto success) / 대결 (contest) / 효과참조 (effect reference) / a number / '-'.
  //  - 자동성공: succeeds with no roll
  //  - 대결: a contested roll (compared against the opponent's roll value)
  //  - 효과참조: a textual reference (handled manually by the user)
  //  - a number: a fixed target value
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

  // Combining difficulties (rulebook p.13, "changing the difficulty"):
  //  - If even one 대결 is present, the result is automatically 대결.
  //  - Otherwise the highest (strictest) numeric difficulty applies.
  //  - When 자동성공 mixes with a non-auto-success (a number / 대결), the non-auto-success applies (auto success is excluded).
  //  - With only 효과참조 / other / unstated ('-'), it cannot be decided automatically (the user's value is kept).
  // Priority (higher wins): 대결 > a number (the maximum) > 자동성공.
  // Returns: { value:string, resolved:boolean } — resolved=false keeps the user's value.
  function combineDifficulty(rawList) {
    const cls = (rawList || []).map(classifyDifficulty);
    if (cls.some(c => c.option === '대결')) return { value: '대결', resolved: true };
    const nums = cls.filter(c => c.option === '숫자').map(c => parseInt(c.param, 10)).filter(n => !isNaN(n));
    if (nums.length > 0) return { value: String(Math.max(...nums)), resolved: true };
    if (cls.some(c => c.option === '자동성공')) return { value: '자동성공', resolved: true };
    return { value: '-', resolved: false };
  }

  // Is the range value the special 「무기」 (weapon) directive (substitute the weapon's range on combination)?
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

  // ===== Sheet (dropdown) wiring helpers =====
  // The field context passed to the template: the option list, the initial selection, and whether a parameter is shown.
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

  // The option values that open a parameter input per kind (plus '기타', which is common). For target, both 대상수 and 레벨대상수 carry a numeric input.
  const PARAM_OPTIONS = { range: ['거리'], target: ['대상수', '레벨대상수'], difficulty: ['숫자'] };
  function isParamOption(kind, option) {
    return option === '기타' || (PARAM_OPTIONS[kind] || []).includes(option);
  }

  // The dropdown selection plus the parameter input → the canonical value to store.
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

  // Wiring for .rt-field[data-rt] (select.rt-option + input.rt-param + input[type=hidden][name=system.range|target]).
  // Saved immediately through the update(item, {'system.range': value}) callback.
  function setupFieldListeners(root, item, { update } = {}) {
    if (!root || !update) return;
    root.querySelectorAll('.rt-field[data-rt]').forEach(field => {
      const kind = field.dataset.rt;
      const sel = field.querySelector('.rt-option');
      const param = field.querySelector('.rt-param');
      const hidden = field.querySelector('input[type="hidden"]');
      if (!sel || !hidden) return;
      const apply = async ({focusParam = false} = {}) => {
        const show = isParamOption(kind, sel.value);
        // The template hides it with the hidden attribute. Clearing the inline display still left [hidden]{display:none}
        // in force, so the input never became visible; with no number entered, composeValue below then stored '-' and
        // the option just chosen reverted to '-' every time.
        if (param) {
          param.hidden = !show;
          param.style.removeProperty('display');
        }
        const raw = param ? String(param.value ?? '').trim() : '';
        // Nothing is stored while a parametric option's number is still empty — storing it would have that update's
        // re-render overwrite the selection with '-'. The input is focused instead, waiting for a value.
        // It is focused only when the dropdown was just chosen — refocusing from the parameter input's blur would
        // make it a focus trap the user could not leave while the field is empty.
        if (show && !raw) {
          if (focusParam) param?.focus();
          return;
        }
        const value = composeValue(kind, sel.value, raw);
        hidden.value = value;
        try { await update(item, { [`system.${kind}`]: value }); }
        catch (e) { console.error('DX3rd | RangeTarget field update failed', e); }
      };
      sel.addEventListener('change', () => apply({focusParam: true}));
      if (param) {
        param.addEventListener('change', () => apply());
        param.addEventListener('blur', () => apply());
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
