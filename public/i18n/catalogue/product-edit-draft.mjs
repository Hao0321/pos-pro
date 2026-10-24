const rows={
 '只改要調整的資料，其餘會保留。':['Change only what you need. Other data is kept.','必要な項目だけ変更してください。他のデータは保持されます。','只改要调整的数据，其余会保留。'],
 '繼續修改商品':['Continue editing product','商品の編集を再開','继续修改商品'],
 '還有上次未完成的商品修改，請先接回核對。':['A previous product edit is unfinished. Resume and check it first.','前回の商品編集が未完了です。先に再開して確認してください。','还有上次未完成的商品修改，请先接回核对。'],
 '商品已更新，請先核對差異。':['This product changed. Check the differences first.','商品が更新されました。先に違いを確認してください。','商品已更新，请先核对差异。'],
 '店面目前：{0}':['Current store value: {0}','店舗の現在の値：{0}','店面当前：{0}'],
 '你填的是：{0}':['Your input: {0}','入力した値：{0}','你填的是：{0}'],
 '採用店面最新資料':['Use current store values','店舗の最新の値を使う','采用店面最新资料'],
 '保留我的修改':['Keep my changes','自分の変更を残す','保留我的修改'],
 '資料又更新了，請再核對差異。':['The data changed again. Please check the differences again.','データが再更新されました。違いをもう一度確認してください。','数据又更新了，请再核对差异。'],
 '已接回核對後的內容，按儲存才會更新。':['Reviewed input is ready. Save to update the product.','確認後の入力を再開しました。保存すると更新されます。','已接回核对后的内容，按保存才会更新。'],
 '先前修改已保存，已讀取最新商品。':['The previous edit was saved. Latest products are loaded.','前回の編集は保存済みです。最新の商品を読み込みました。','先前修改已保存，已读取最新商品。'],
 '請先核對這次商品保存結果。':['Check the result of this product save first.','今回の商品保存結果を先に確認してください。','请先核对这次商品保存结果。'],
 '商品保存紀錄需要核對，請保留原輸入。':['The product save record needs checking. Keep your original input.','商品保存記録の確認が必要です。元の入力を保持してください。','商品保存记录需要核对，请保留原输入。'],
 '原商品保存編號內容不同，請保留輸入並核對。':['The original product-save ID has different content. Keep your input and check it.','元の商品保存番号と内容が異なります。入力を保持して確認してください。','原商品保存编号内容不同，请保留输入并核对。'],
 '找不到原商品，原輸入仍保留。':['The original product was not found. Your input is kept.','元の商品が見つかりません。入力は保持されています。','找不到原商品，原输入仍保留。'],
 '尚未找到這次修改，請再次確認原內容。':['This edit was not found. Confirm the original content again.','今回の編集が見つかりません。元の内容を再確認してください。','尚未找到这次修改，请再次确认原内容。'],
 '商品保存紀錄由正式保存與完整備份流程管理。':['Product-save records are managed by the save and complete-backup workflows.','商品保存記録は正式な保存と完全バックアップで管理されます。','商品保存记录由正式保存与完整备份流程管理。'],
 '請填商品名稱、單位與正確金額，原輸入會保留。':['Enter a product name, unit and valid amounts. Your input is kept.','商品名、単位、正しい金額を入力してください。入力は保持されます。','请填商品名称、单位与正确金额，原输入会保留。'],
 '再次確認商品修改':['Confirm product edit again','商品編集を再確認','再次确认商品修改'],
 '核對這次商品修改':['Check this product edit','今回の商品編集を確認','核对这次商品修改']
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38800+index]]))
