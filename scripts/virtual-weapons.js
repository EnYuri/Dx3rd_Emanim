/**
 * Virtual Weapon (가상 무기) — 「무기 없음」 한 종류
 *
 * 공격 판정에서 **무기를 고르지 않고 진행**하기 위한 껍데기 한 장이다.
 * 빈 선택도 같은 뜻으로 통과하지만(2026-09-07 — 그 전에는 경고 후 정지라 막다른 길이었다),
 * 이 행은 「무기 없이 간다」를 **명시적으로 고르는** 자리로 남긴다.
 *
 * ── 왜 두 종류에서 한 종류가 됐나 ──────────────────────────────────────────
 * 예전에는 `RC : 백병` / `RC : 사격` 두 장이었고, 「대응 무기가 없어도 백병/사격 공격
 * 채널을 제공한다」가 목적이었다. **그 목적은 이미 다른 곳에서 달성돼 있다** — 공격 종류는
 * 아이템 자신의 `system.attackRoll` 이 정하고(`resolveAttackType`), 액터 기본 공격력·관통은
 * `resolveAttackBonuses` 가 그 타입으로 직접 집으며, 데미지 버튼도 `attackRoll` 만 보고 난다
 * (`universal-roll-dialog` 의 `isAttackRoll`). 이펙트 자체 수정치·공격력은 `effectAttackBonus`
 * 가 무기 없이 운반한다.
 *
 * 실측(2026-08-14, 팩+월드 3872건): `system.weapon` 에 가상 무기를 등록한 문서는 **0건**이고,
 * `weaponSelect` 가 켜진 5건은 전부 실무기가 등록돼 있다. 즉 두 장은 한 번도 쓰이지 않았고,
 * 그러면서 무기 드롭다운의 첫 항목이 되어 `weaponTmp` 유출 버그의 표적이 됐다(93건 오염).
 *
 * 그래서 남은 유일한 역할 —「무기 없이 진행」— 만 남기고 한 장으로 줄였다:
 *  - 이름은 `-`. 목록에서 아무것도 고르지 않은 것처럼 보인다.
 *  - 공격 종류(`type`/`skill`)만 호출 문맥의 `attackRoll`(백병/사격)을 따른다. 그 외 수치는
 *    전부 빈칸이다 — 더할 것이 없으므로 표에도 0 이 아니라 아무것도 그리지 않는다.
 *  - 이것만 고르면 무기 보너스 자체를 `null` 로 돌려준다(`confirmSelection`). 판정 카드에
 *    「무기: -」 같은 줄이 생기지 않고, 정말 안 고른 것과 같은 결과가 된다.
 *  - 시트의 무기 등록 드롭다운에는 넣지 않는다. 거기에는 이미 「아무것도 아님」을 뜻하는
 *    정적 `-` 옵션이 있어 두 벌이 되고, 등록해 봐야 수치 기여가 0 이라 의미가 없다.
 */
(function() {
    /** 지금 쓰는 단 하나의 id. */
    const VIRTUAL_ID = 'virtual-none';
    /** 옛 두 장. 남아 있는 저장값을 해석만 해 주고 새로 만들지는 않는다. */
    const LEGACY_TYPES = {'virtual-melee': 'melee', 'virtual-ranged': 'ranged'};
    const ATTACK_TYPES = ['melee', 'ranged'];

    /**
     * @param {string} [attackType] 'melee' | 'ranged'. 그 외/미지정이면 공격 종류도 비운다.
     */
    function build(attackType) {
        const type = ATTACK_TYPES.includes(attackType) ? attackType : '';
        return {
            id: VIRTUAL_ID,
            name: '-',
            type: 'weapon',
            sort: -1,
            isVirtualWeapon: true,
            system: {
                // 공격 종류(= 방어 판정 분류). 실제 판정은 아이템의 attackRoll 을 따르므로
                // 이 값은 표시용이며, 문맥이 없으면 비워 둔다.
                type,
                skill: type,
                // 더하는 것이 없다 — 빈 문자열이라야 다이얼로그 표에 0 이 아니라 빈칸이 뜬다.
                add: '',
                attack: '',
                guard: '',
                range: '',
                equipment: false,
                'attack-used': {state: 0, max: 0, disable: 'notCheck'},
                virtual: true
            }
        };
    }

    window.DX3rdVirtualWeapons = {
        ID: VIRTUAL_ID,
        isVirtual: (id) => typeof id === 'string'
            && (id === VIRTUAL_ID || Object.prototype.hasOwnProperty.call(LEGACY_TYPES, id)),
        /** 옛 id 는 자기 이름에서 공격 종류를 되찾는다(문맥 인자가 우선). */
        get: (id, attackType) => window.DX3rdVirtualWeapons.isVirtual(id)
            ? build(attackType ?? LEGACY_TYPES[id])
            : null,
        /** 공격 다이얼로그에 얹을 목록 — 언제나 한 장이다. */
        list: (attackType) => [build(attackType)]
    };

    /**
     * 무기 id를 액터-로컬 아이템 또는 가상 무기로 해석한다.
     * 가상 id면 항상 껍데기 객체를 반환하고, 아니면 actor.items.get 폴백.
     */
    window.DX3rdResolveWeapon = (actor, id, attackType) =>
        window.DX3rdVirtualWeapons.isVirtual(id)
            ? window.DX3rdVirtualWeapons.get(id, attackType)
            : actor?.items?.get?.(id);
})();
