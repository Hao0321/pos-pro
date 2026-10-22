const rows={
 '訂位訂金':['Reservation deposits','予約金','订位订金'],
 '訂位訂金實收 · {0}':['Reservation deposit received · {0}','予約金受領 · {0}','订位订金实收 · {0}'],
 '訂位訂金退款 · {0}':['Reservation deposit refund · {0}','予約金返金 · {0}','订位订金退款 · {0}'],
 '請核對訂金條件與金額。':['Check the deposit terms and amount.','予約金の条件と金額をご確認ください。','请核对订金条件与金额。'],
 '請先核對這筆訂位的訂金條件，再確認訂位。':['Review this reservation’s deposit terms before confirming.','予約金の条件を確認してから予約を確定してください。','请先核对这笔订位的订金条件，再确认订位。'],
 '訂金資料已更新，請重新核對。':['The deposit details changed. Please review them again.','予約金の内容が更新されました。再度ご確認ください。','订金资料已更新，请重新核对。'],
 '訂金原收款或可用餘額需要核對。':['Check the original deposit receipt and available amount.','元の予約金受領と利用可能額をご確認ください。','订金原收款或可用余额需要核对。'],
 '現金訂金與退款需要目前開啟的班次。':['Cash deposits and refunds need the currently open shift.','現金の予約金と返金には営業中のシフトが必要です。','现金订金与退款需要目前开启的班次。'],
 '訂金與原收款尚未找回，請先用完整備份核對復原。':['The deposit and original receipt are missing. Recover them from a complete backup first.','予約金と元の受領記録が見つかりません。完全バックアップから復元してください。','订金与原收款尚未找回，请先用完整备份核对复原。'],
 '訂金金額須為有效整數分，且不可超過原來源。':['Use a valid amount in whole minor units within the original source balance.','最小通貨単位の整数で、元の残高以内の金額を指定してください。','订金金额须为有效整数分，且不可超过原来源。'],
 '訂金原紀錄需要核對，請保留原編號。':['Keep the original ID and check the deposit record.','元の番号を保管して予約金記録をご確認ください。','订金原纪录需要核对，请保留原编号。'],
 '訂金現金流水只能由正式訂位收退款保存':['Deposit cash entries must come from the reservation payment flow.','予約金の現金記録は正式な予約の収支手順で保存してください。','订金现金流水只能由正式订位收退款保存'],
 '訂金資料需要核對，請保留原編號。':['Keep the original ID and check the deposit details.','元の番号を保管して予約金の内容をご確認ください。','订金资料需要核对，请保留原编号。'],
 '包含訂位訂金、餐飲與往來收付；抵款和交付不會重複計入。':['Includes reservation deposits, meal payments and trading cash flows. Credit application and fulfilment are not counted twice.','予約金、飲食代金、取引の入出金を含みます。充当と提供を重複計上しません。','包含订位订金、餐饮与往来收付；抵款和交付不会重复计入。'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,38000+index]]))
