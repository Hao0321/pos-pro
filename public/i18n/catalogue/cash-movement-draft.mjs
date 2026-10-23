const rows={
 '繼續記現金進出':['Continue cash entry','現金の出入りの入力を再開','继续记现金进出'],
 '改記到目前班次':['Use the current shift','現在のシフトに記録する','改记到当前班次'],
 '原班次已結束，請核對這筆現金要記在哪一班。':['The original shift ended. Check which shift this cash belongs to.','元のシフトは終了しました。この現金を記録するシフトを確認してください。','原班次已结束，请核对这笔现金要记在哪一班。'],
 '已改到目前班次，請確認金額與原因。':['Current shift selected. Check the amount and reason.','現在のシフトに変更しました。金額と理由を確認してください。','已改到当前班次，请确认金额与原因。'],
 '現金流水回覆不完整，請保留原輸入。':['The cash record is unconfirmed. Keep your original input.','現金記録が未確認です。元の入力を保持してください。','现金流水回复不完整，请保留原输入。'],
 '原現金紀錄內容不同，請保留輸入並核對。':['The original cash record differs. Keep your input and check it.','元の現金記録と異なります。入力を保持して確認してください。','原现金记录内容不同，请保留输入并核对。'],
 '請先核對原現金紀錄。':['Check the original cash record first.','元の現金記録を先に確認してください。','请先核对原现金记录。'],
 '請填正確金額與現金進出原因。':['Enter a valid amount and a reason for the cash movement.','正しい金額と現金の出入りの理由を入力してください。','请填正确金额与现金进出原因。'],
 '尚未找到原紀錄，請再確認這一筆。':['No original record was found. Confirm this same entry again.','元の記録が見つかりません。この同じ入力を再確認してください。','尚未找到原记录，请再确认这一笔。'],
 '放入抽屜 NT$ {0}':['Put NT$ {0} into the drawer','引き出しに NT$ {0} を入れる','放入抽屉 NT$ {0}'],
 '從抽屜取出 NT$ {0}':['Take NT$ {0} from the drawer','引き出しから NT$ {0} を出す','从抽屉取出 NT$ {0}'],
 '確認放入':['Confirm cash in','入金を確定','确认放入'],
 '確認取出':['Confirm cash out','出金を確定','确认取出'],
 '核對這筆現金':['Check this cash entry','この現金記録を確認','核对这笔现金'],
 '再次確認這一筆':['Confirm this entry again','この記録を再確認','再次确认这一笔']
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38700+index]]))
