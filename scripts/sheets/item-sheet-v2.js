/**
 * Double Cross 3rd AppV2 Item Sheet base.
 * AppV2 item sheet base shared by every DX3rd item sheet.
 */
(function() {
    const api = foundry.applications?.api;
    const ItemSheetV2 = foundry.applications?.sheets?.ItemSheetV2;
    const itemSheetData = window.DX3rdItemSheetData;
    const compat = window.DX3rdApplicationCompat;
    if (!api?.HandlebarsApplicationMixin || !ItemSheetV2 || !itemSheetData) {
        console.warn('DX3rd | AppV2 item sheets are unavailable in this Foundry version.');
        return;
    }

    class DX3rdItemSheetV2 extends api.HandlebarsApplicationMixin(ItemSheetV2) {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'sheet', 'item'],
            position: {
                width: 540,
                height: 620
            },
            window: {
                resizable: true
            },
            form: {
                closeOnSubmit: false,
                submitOnChange: true
            }
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            return itemSheetData.prepareAppV2Context(this.item, context);
        }

        /**
         * 폼에서 뽑아낸 서브밋 데이터에 값이 undefined 인 키가 섞이면
         * DataModel 검증이 `name: may not be undefined` 처럼 실패해 서브밋이 통째로 취소된다.
         * 부분 업데이트에서 undefined 는 "해당 필드 미변경"과 같으므로 키 자체를 제거한다.
         * 어떤 컨트롤이 값을 못 내놨는지 추적할 수 있도록 제거 시 경고를 남긴다.
         */
        _processFormData(event, form, formData) {
            const data = super._processFormData(event, form, formData);
            const dropped = compat?.pruneUndefinedValues?.(data) ?? [];
            if (dropped.length) {
                console.warn(`DX3rd | 값이 없는 폼 필드를 서브밋에서 제외했습니다: ${dropped.join(', ')}`, {
                    sheet: this.constructor.name,
                    item: this.document?.uuid,
                    fields: dropped.map(key => form?.elements?.namedItem?.(key))
                });
            }
            return data;
        }

        /**
         * 서브밋을 유발한 폼 컨트롤의 name 을 안전하게 얻는다.
         * FilePicker 콜백(아이콘 변경)처럼 form 자체가 event.target 인 경우,
         * HTMLFormElement 의 named-property 접근 때문에 form.name 이 문자열이 아니라
         * name="name" 인 입력 요소를 돌려준다. 그대로 .endsWith 를 호출하면 TypeError 로
         * 서브밋이 통째로 죽어 이미지 변경이 저장되지 않았다. 문자열일 때만 반환한다.
         * @returns {string|null}
         */
        _getChangedFieldName(event) {
            const name = event?.target?.name;
            return (typeof name === 'string') ? name : null;
        }

        async _onDrop(event) {
            return itemSheetData.handleMacroDrop(this.item, event, {
                fallback: () => super._onDrop(event),
                fallbackOnInvalidData: true
            });
        }
    }

    window.DX3rdItemSheetV2 = DX3rdItemSheetV2;
})();
