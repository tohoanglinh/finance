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

Dùng khi quy định thay đổi theo thời gian (biểu thuế, giảm trừ gia cảnh, trần BHXH...). Ở tab **Cài đặt**, bấm **+ Thêm giai đoạn**: form hiện mọi tham số, điền sẵn giá trị đang áp dụng tại tháng bắt đầu; bạn chọn "Từ tháng" và (tùy chọn) "Đến hết tháng", rồi sửa các ô cần đổi. Mỗi tham số thay đổi được lưu thành một dòng trong sheet `GiaiDoan`; bấm **Sửa** ở dòng đó để chỉnh riêng. Sau tháng kết thúc, tham số quay về giá trị trước đó (bảng Cài đặt tham số hoặc giai đoạn trước).

## Lưu ý

- Mức trần BHXH từ 07/2026 (50,6 triệu) và lương tối thiểu vùng là các tham số trong tab Cài đặt, hãy đối chiếu với thông báo của BHXH nơi bạn đóng.
- Thuế bán chứng chỉ quỹ: mặc định tính 0,1%; chỉnh `sellTaxTypes` nếu quỹ của bạn xử lý khác.
- Ứng dụng chỉ mang tính tham khảo, không thay thế quyết toán thuế chính thức.

## Phân tích bằng AI (tùy chọn)

Nút **✨ Phân tích ngay** ở tab Tổng quan gửi số liệu tổng hợp cho một mô hình AI và hiện nhận xét về sức khỏe tài chính. Khóa API chỉ nằm ở máy chủ Apps Script, không nằm trong code hay trình duyệt.

1. Lấy khóa API: **Gemini** tại Google AI Studio, hoặc **Anthropic** tại console của Anthropic.
2. Trong Apps Script: **Cài đặt dự án** (biểu tượng bánh răng) → **Thuộc tính tập lệnh** → **Thêm thuộc tính tập lệnh**:
   - `AI_PROVIDER` = `gemini` (mặc định) hoặc `anthropic`
   - `GEMINI_API_KEY` hoặc `ANTHROPIC_API_KEY` = khóa của bạn
   - `AI_MODEL` (tùy chọn) = tên model. Để trống thì dùng mặc định `gemini-flash-latest` hoặc `claude-haiku-5-5`. Nếu báo lỗi model, vào trang danh sách model của nhà cung cấp, lấy đúng tên model hiện hành rồi điền vào đây.
3. Dán `appsscript.json` mới (đã có thêm quyền `script.external_request`), triển khai phiên bản mới và cấp quyền lại khi được hỏi.

Quyền riêng tư: chỉ gửi số liệu tổng hợp (không có tên sổ, mã cổ phiếu, ghi chú); bấm "Dữ liệu đã gửi cho AI" dưới kết quả để xem chính xác những gì đã gửi. Với Gemini, gói miễn phí (chưa bật thanh toán) cho phép Google dùng dữ liệu gửi lên để cải thiện sản phẩm và người đánh giá có thể đọc; hãy đọc điều khoản hiện hành của nhà cung cấp trước khi gửi số liệu tài chính thật.

