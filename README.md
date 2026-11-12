# Quản lý tài chính cá nhân (Google Apps Script)

## Cài đặt (5 phút)

1. Tạo Google Sheet mới (sheets.new), đặt tên tùy ý.
2. Menu **Tiện ích mở rộng → Apps Script**.
3. Trong trình soạn thảo:
   - Đổi tên file `Code.gs` có sẵn thì dán toàn bộ nội dung file **Code.gs** vào.
   - Bấm **+ → HTML**, đặt tên đúng là `Index`, dán nội dung file **Index.html**.
   - (Tùy chọn) Bật **Cài đặt dự án → Hiển thị tệp kê khai appsscript.json**, rồi dán nội dung file **appsscript.json**.
4. Bấm **Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web**
   - Thực thi dưới tên: **Tôi**
   - Ai có quyền truy cập: **Chỉ mình tôi**
5. Cấp quyền khi được hỏi, mở đường link ứng dụng web. Các sheet dữ liệu tự được tạo ở lần mở đầu tiên.

Mỗi lần sửa code: **Triển khai → Quản lý triển khai → Sửa → Phiên bản mới**.

## Dữ liệu

Toàn bộ dữ liệu nằm trong sheet của bạn: `TietKiem`, `GiaoDichDauTu`, `GiaHienTai`, `Luong`, `CauHinh`. Có thể sửa trực tiếp trên sheet.

## Công thức

- Tiền không kỳ hạn: chỉ lưu số dư hiện tại, bạn cập nhật tay bằng nút "Cập nhật số dư". Lãi suất là tùy chọn, chỉ dùng để ước tính (gốc × lãi suất × số ngày / 365 từ lần cập nhật gần nhất) và không cộng vào số dư.
- Có kỳ hạn, lãi cuối kỳ: lãi = gốc × lãi suất × số tháng / 12.
- Có kỳ hạn, lãi hàng tháng: mỗi tháng = gốc × lãi suất / 12.
- Đầu tư: giá vốn bình quân gia quyền (gồm phí mua); thuế bán 0,1% tự tính theo loại tài sản (sửa ở CauHinh).
- Lương: BH người lao động 10,5% (có trần), giảm trừ 15,5tr + 6,2tr/người phụ thuộc, biểu thuế tháng 5 bậc 5/10/20/30/35%.

## Giai đoạn áp dụng

Dùng khi quy định thay đổi theo thời gian (biểu thuế, giảm trừ gia cảnh, trần BHXH...). Ở tab **Cài đặt**, bấm **+ Thêm giai đoạn**: form hiện mọi tham số, điền sẵn giá trị của tháng liền trước tháng bắt đầu để tham khảo; bạn chọn "Từ tháng" và (tùy chọn) "Đến hết tháng", rồi sửa các ô cần đổi. Mỗi tham số thay đổi được lưu thành một dòng trong sheet `GiaiDoan`; bấm **Sửa** ở dòng đó để chỉnh riêng. Sau tháng kết thúc, tham số quay về giá trị trước đó (giai đoạn trước hoặc giá trị gốc trong sheet `CauHinh`).

Bảng giai đoạn hiển thị 10 dòng mỗi trang, mới nhất trước. Ô **Tra cứu nhanh theo giai đoạn** cho chọn một khoảng thời gian (VD 2024-07 → 2025-12): bảng lọc theo khoảng đó và hiện toàn bộ cài đặt áp dụng trong giai đoạn, ghi rõ tham số nào do giai đoạn thay đổi. Hoặc chọn một tháng bất kỳ ở ô **xem cài đặt tại tháng**.

## Lưu ý

- Mức trần BHXH từ 07/2026 (50,6 triệu) và lương tối thiểu vùng là các tham số, chỉnh bằng cách thêm giai đoạn ở tab Cài đặt, hãy đối chiếu với thông báo của BHXH nơi bạn đóng.
- Thuế bán chứng chỉ quỹ: mặc định tính 0,1%; chỉnh `sellTaxTypes` nếu quỹ của bạn xử lý khác.
- Ứng dụng chỉ mang tính tham khảo, không thay thế quyết toán thuế chính thức.

## Phân tích bằng AI (tùy chọn)

Nút **✨ Phân tích ngay** ở tab Tổng quan gửi số liệu tổng hợp cho một mô hình AI và hiện nhận xét về sức khỏe tài chính. Khóa API chỉ nằm ở máy chủ Apps Script, không nằm trong code hay trình duyệt.

1. Lấy khóa API: **Gemini** tại Google AI Studio, hoặc **Anthropic** tại console của Anthropic.
2. Trong Apps Script: **Cài đặt dự án** (biểu tượng bánh răng) → **Thuộc tính tập lệnh** → **Thêm thuộc tính tập lệnh**:
   - `AI_PROVIDER` = `gemini` (mặc định) hoặc `anthropic`
   - `GEMINI_API_KEY` hoặc `ANTHROPIC_API_KEY` = khóa của bạn
   - `AI_MODEL` (tùy chọn) = tên model. Để trống thì dùng mặc định `gemini-3.5-flash-lite` hoặc `claude-haiku-5-5`. Nếu báo lỗi model, vào trang danh sách model của nhà cung cấp, lấy đúng tên model hiện hành rồi điền vào đây.
3. Dán `appsscript.json` mới (đã có thêm quyền `script.external_request`), triển khai phiên bản mới và cấp quyền lại khi được hỏi.

### Hỏi đáp với AI

Khung **Hỏi đáp với AI** ở tab Tổng quan, ngay dưới phần phân tích, cho bạn hỏi tự do (VD "tiền không kỳ hạn đủ chi tiêu mấy tháng?", "tháng này tôi chi vượt khoản nào?"). Dùng chung khóa API và model ở trên, không cần cấu hình thêm. Enter để gửi, Shift+Enter để xuống dòng. Mỗi câu hỏi gửi kèm số liệu tổng hợp mới nhất và tối đa 12 tin nhắn gần nhất của cuộc trò chuyện; cuộc trò chuyện chỉ nằm trên trang, tải lại là mất. Mỗi lần gửi tính một lượt gọi API (có thể tốn hạn mức/tiền).

Quyền riêng tư: chỉ gửi số liệu tổng hợp (không có tên sổ, mã cổ phiếu, ghi chú); tên các khoản chi tiêu bạn tự đặt (VD Utility, Con cái) có được gửi kèm số liệu ngân sách và thực chi; bấm "Dữ liệu đã gửi cho AI" dưới kết quả để xem chính xác những gì đã gửi. Chat dùng cùng số liệu này. Với Gemini, gói miễn phí (chưa bật thanh toán) cho phép Google dùng dữ liệu gửi lên để cải thiện sản phẩm và người đánh giá có thể đọc; hãy đọc điều khoản hiện hành của nhà cung cấp trước khi gửi số liệu tài chính thật.

