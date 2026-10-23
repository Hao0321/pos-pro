const rows={
 '待核對的紀錄已變更，請重新核對。':['The pending record changed. Please check it again.','確認待ちの記録が変わりました。もう一度確認してください。','待核对的记录已变更，请重新核对。'],
 '還沒有可確認的原紀錄，請保留資料核對。':['The original result is still unconfirmed. Keep the data for review.','元の結果をまだ確認できません。データを保管してください。','还没有可确认的原记录，请保留资料核对。'],
 '這筆已確認':['This result is confirmed','この記録を確認できました','这笔已确认'],
 '剛才那筆需要協助核對':['Help is needed to check the last action','直前の記録の確認にサポートが必要です','刚才那笔需要协助核对'],
 '正在確認這筆資料':['Checking the original result','元の記録を確認中','正在确认这笔资料'],
 '剛才那筆還沒確認':['The last result is not yet confirmed','直前の結果をまだ確認できていません','刚才那笔还没确认'],
 '可以繼續剛才的工作了。':['You can continue your work.','作業を続けられます。','可以继续刚才的工作了。'],
 '請店主協助核對，原資料已保留。':['Ask the store owner to help. The original data is retained.','店舗の管理者に確認を依頼してください。元のデータは保管されています。','请店主协助核对，原资料已保留。'],
 '請稍候，先不要重做或再次收款。':['Please wait. Do not repeat the action or collect payment again.','お待ちください。操作や代金の受け取りを繰り返さないでください。','请稍候，先不要重做或再次收款。'],
 '還沒找到保存結果，可以沿用原單號繼續保存。':['No saved result was found. You may save using the original order number.','保存結果が見つかりません。元の番号で保存を続けられます。','还没找到保存结果，可以沿用原单号继续保存。'],
 '先核對剛才的收款結果，請勿再收款。':['Check the previous payment result first. Do not collect payment again.','先に直前の会計結果を確認してください。再度代金を受け取らないでください。','先核对刚才的收款结果，请勿再收款。'],
 '先不要重做或再收款，系統會接續原來那筆。':['Do not repeat the action or collect again. The system will resume the original action.','操作や代金の受け取りを繰り返さないでください。元の記録を引き継ぎます。','先不要重做或再收款，系统会接续原来那笔。'],
 '還沒確認完成，原資料已保留，請勿重做。':['The result is still unconfirmed. The original data is retained; do not repeat the action.','まだ結果を確認できません。元のデータは保管されています。操作を繰り返さないでください。','还没确认完成，原资料已保留，请勿重做。'],
 '繼續保存這張單':['Save the original order','元の伝票の保存を続ける','继续保存这张单'],
 '再次核對結果':['Check the result again','結果をもう一度確認','再次核对结果'],
 '繼續操作':['Continue working','作業を続ける','继续操作'],
 '需要協助？':['Need help?','お困りですか？','需要协助？'],
 '查看原單資訊':['Original record details','元の記録の詳細','查看原单信息'],
 '這次沒有保存':['This action was not saved','今回は保存されませんでした','这次没有保存'],
 '請先查看原因，再回原來的工作畫面修改。':['Check the reason, then return to your work to make changes.','理由を確認してから、元の画面で修正してください。','请先查看原因，再回原来的工作画面修改。'],
 '有 {0} 筆結果待核對':['{0} results need checking','確認が必要な結果が {0} 件あります','有 {0} 笔结果待核对']
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38200+index]]))
