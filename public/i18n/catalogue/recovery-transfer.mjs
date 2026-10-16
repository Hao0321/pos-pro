const rows={
 '顯示更多':['Show more','さらに表示','显示更多'],
 '保留原單號，安心核對':['Keep the original order ID for review','元の伝票番号で確認します','保留原单号，安心核对'],
 '會先保存目前資料。':['Your current data will be saved first.','現在のデータを先に保存します。','会先保存当前数据。'],
 '我確認要還原這份資料':['I want to restore this copy','このデータを復元します','我确认要还原这份数据'],
 '另有 {0} 項變動':['{0} more changes','ほかに {0} 項目の変更','另有 {0} 项变动'],
 '下載完整備份':['Download full backup','完全なバックアップをダウンロード','下载完整备份'],
 '還原前的副本':['Copies before restore','復元前のコピー','还原前的副本'],
 '找回這份資料':['Recover this copy','このコピーを復元','找回这份资料'],
 '一併帶回 {0} 份保護副本':['Includes {0} protected copies','{0} 件の保護コピーも復元します','一并带回 {0} 份保护副本'],
 '舊備份：不含完整保護紀錄，原裝置的紀錄仍會保留。':['Older backup: protected history is incomplete. History on this device is kept.','旧形式のバックアップには完全な保護履歴がありません。この端末の履歴は保持されます。','旧备份：不含完整保护记录，原设备的记录仍会保留。'],
 '備份保護紀錄不完整或內容不同，請保留原檔核對':['Backup history is incomplete or has changed. Keep the original file for review.','バックアップの保護記録が不完全、または内容が異なります。元のファイルを保管して確認してください。','备份保护记录不完整或内容不同，请保留原文件核对'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,row],index)=>[key,[...row,15000+index]]))
