const rows={
 '還有上次未完成的點算，請先接回核對。':['A previous count is unfinished. Resume and check it first.','前回の点算が未完了です。先に再開して確認してください。','还有上次未完成的点算，请先接回核对。'],
 '班別或現金已變動，請重新點算。':['The shift or cash activity changed. Please count again.','シフトまたは現金の動きが変わりました。もう一度数えてください。','班次或现金已变动，请重新点算。'],
 '原開班內容不同，請保留點算並核對。':['The saved opening differs. Keep your count and check it.','保存された開始記録と異なります。点算を保持して確認してください。','原开班内容不同，请保留点算并核对。'],
 '原交班內容不同，請保留點算並核對。':['The saved closing differs. Keep your count and check it.','保存された締め記録と異なります。点算を保持して確認してください。','原交班内容不同，请保留点算并核对。'],
 '上次點算的保存結果還沒確認，請先核對原班別。':['The previous count result is unconfirmed. Check the original shift first.','前回の点算の保存結果が未確認です。元のシフトを先に確認してください。','上次点算的保存结果还没确认，请先核对原班次。'],
 '已接回上次點算，請核對抽屜現金。':['Your last count is back. Check the cash in the drawer.','前回の点算を再開しました。引き出しの現金を確認してください。','已接回上次点算，请核对抽屉现金。'],
 '尚未找到保存結果，請再確認原點算。':['No saved result was found. Please confirm the original count again.','保存結果が見つかりませんでした。元の点算をもう一度確認してください。','尚未找到保存结果，请再确认原点算。'],
 '已找到原開班紀錄。':['The original opening record was found.','元の開始記録を確認しました。','已找到原开班记录。'],
 '已找到原交班紀錄。':['The original closing record was found.','元の締め記録を確認しました。','已找到原交班记录。'],
 '繼續點算現金':['Continue counting cash','現金の点算を再開','继续点算现金'],
 '重新點算':['Count again','もう一度数える','重新点算'],
 '點算選項':['Count options','点算の操作','点算选项'],
 '放棄這次點算':['Discard this count','今回の点算を破棄','放弃这次点算'],
 '核對上次開班':['Check previous opening','前回の開始結果を確認','核对上次开班'],
 '核對上次交班':['Check previous closing','前回の締め結果を確認','核对上次交班'],
 '再次確認開班':['Confirm opening again','開始を再確認','再次确认开班'],
 '再次確認交班':['Confirm closing again','締めを再確認','再次确认交班']
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38600+index]]))
