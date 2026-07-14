/**
 * Virtual Weapons (가상/월드 무기)
 *
 * 액터 시트에 실제 무기 아이템을 심지 않고, 무기 선택/등록에서 "참조만" 하는 껍데기 무기.
 * 목적: '~사격/백병 공격을 실행한다' 같은 자체 공격 이펙트가, 액터에 대응 무기가
 *       없어도 백병/사격 공격 채널을 굴릴 수 있게 한다.
 *
 * 설계 규칙:
 *  - attack/add = 0 → 무기 자체는 데미지를 더하지 않는다. 실제 데미지는 이펙트 Extend가 결정.
 *  - 판정 기능은 이펙트의 skill을 그대로 따른다(대개 RC). 무기의 skill 필드는 표시용일 뿐이다.
 *  - id는 'virtual-melee' / 'virtual-ranged'로 고정(stable) → 컴펜디움 이펙트가
 *    system.weapon 배열에 그대로 저장해도 액터와 무관하게 참조된다.
 *  - attack-used(공격 횟수)는 notCheck → 소진되지 않고 카운트도 증가하지 않는다.
 */
(function() {
    // 정의는 로컬라이즈 이전(로드 시점)에도 안전하도록 raw 상태로만 보관하고,
    // 실제 이름은 build() 호출 시 게임 로케일로 만든다.
    const DEFS = {
        'virtual-melee':  { attackType: 'melee',  labelKey: 'DX3rd.Melee'  },
        'virtual-ranged': { attackType: 'ranged', labelKey: 'DX3rd.Ranged' }
    };

    function build(id) {
        const def = DEFS[id];
        if (!def) return null;
        const label = game.i18n?.localize?.(def.labelKey);
        const name = `RC : ${label && label !== def.labelKey ? label : def.attackType}`;
        return {
            id,
            name,
            type: 'weapon',
            sort: -1,
            isVirtualWeapon: true,
            system: {
                type: def.attackType,     // 'melee' | 'ranged' (공격 종류 = 방어 판정 분류)
                skill: def.attackType,    // 다이얼로그 표시용
                add: '0',
                attack: '0',
                guard: '0',
                range: def.attackType === 'ranged' ? '' : '1',
                equipment: false,
                'attack-used': { state: 0, max: 0, disable: 'notCheck' },
                virtual: true
            }
        };
    }

    window.DX3rdVirtualWeapons = {
        isVirtual: (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(DEFS, id),
        get: (id) => build(id),
        list: () => Object.keys(DEFS).map(build)
    };

    /**
     * 무기 id를 액터-로컬 아이템 또는 가상 무기로 해석한다.
     * 가상 id면 항상 껍데기 객체를 반환하고, 아니면 actor.items.get 폴백.
     */
    window.DX3rdResolveWeapon = (actor, id) =>
        window.DX3rdVirtualWeapons.isVirtual(id) ? build(id) : actor?.items?.get?.(id);
})();
