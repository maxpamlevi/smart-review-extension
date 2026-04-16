# SRV - AI Code Review Extension

## 1. Giới thiệu

SRV là một VS Code extension hỗ trợ **review code bằng AI** ngay trong editor.
Mục tiêu của extension là giúp developer:

- phát hiện vấn đề trong Git diff nhanh hơn
- nhận gợi ý sửa lỗi rõ ràng và có thể áp dụng trực tiếp
- xem comment review ngay trong VS Code thay vì chuyển sang công cụ khác

Extension được thiết kế để làm việc với **Azure OpenAI / OpenAI-compatible endpoint** thông qua thư viện `openai`.

---

## 2. Các chức năng chính

### 2.1. AI Review code theo Git diff

Khi người dùng mở file trong editor và chạy lệnh **AI: Review Code Diff**, extension sẽ:

1. lấy file hiện tại
2. tạo Git diff của file đó so với `HEAD`
3. gửi diff cho AI
4. nhận lại danh sách comment review ở dạng JSON
5. hiển thị kết quả ngay trong VS Code

Tính năng này giúp review nhanh các thay đổi trước khi commit hoặc push.

### 2.2. Hiển thị comment review trên file

Kết quả AI được render trực tiếp lên editor bằng decoration:

- comment ngắn hiển thị ở cuối dòng
- tooltip chứa đầy đủ:
  - comment
  - suggestion
  - before / after của fix

Nhờ đó người dùng có thể đọc review ngay tại vị trí code liên quan.

### 2.3. Danh sách comment ở sidebar

Extension có một sidebar riêng để hiển thị các comment review theo dạng danh sách.

Mỗi comment có thể:

- xem nội dung review
- click để nhảy đến đúng vị trí trong file

Điều này giúp điều hướng rất nhanh khi có nhiều issue trong cùng một file.

### 2.4. CodeLens để áp dụng fix

Ngay trên từng comment, extension cung cấp nút **Apply Fix** bằng CodeLens.

Khi người dùng bấm vào:

- extension sẽ đọc `before` / `after` từ comment
- tìm anchor tương ứng trong file
- thay thế hoặc chèn code theo hướng dẫn của AI
- cập nhật lại sidebar và decoration sau khi apply

Đây là chức năng quan trọng nhất vì nó biến review từ “chỉ gợi ý” thành “có thể sửa ngay”.

### 2.5. Xem diff của file từ panel

Extension có panel hiển thị các file đã thay đổi trong Git working tree.

Người dùng có thể:

- xem danh sách file modified / untracked
- click để mở diff của file đó
- tự động trigger review nếu file chưa có comment cũ

### 2.6. Tự động làm mới dữ liệu

Extension tự refresh danh sách file khi:

- mở panel
- có thay đổi trong workspace

Điều này giúp UI luôn cập nhật theo trạng thái code mới nhất.

---

## 3. Cách extension hoạt động

### Bước 1: Phát hiện file thay đổi

Extension đọc `git status --porcelain` để lấy danh sách file đang thay đổi.

### Bước 2: Tạo Git diff

Khi review một file, extension chạy lệnh Git để lấy diff:

- với file đã tracked: diff so với `HEAD`
- với file chưa tracked: diff so với file rỗng

### Bước 3: Gửi diff cho AI

Extension dùng `OpenAI` client với:

- `baseURL`: Azure endpoint
- `apiKey`: key cấu hình trong settings
- `model`: deployment name

AI được yêu cầu trả về **JSON thuần** theo một schema xác định.

### Bước 4: Render kết quả

Sau khi nhận JSON, extension:

- parse comments
- hiển thị decoration trên editor
- cập nhật sidebar
- tạo CodeLens để apply fix

### Bước 5: Apply fix

Khi người dùng chọn fix, extension dùng `before` làm anchor để sửa code một cách an toàn.

---

## 4. Các setting chính

Extension hỗ trợ cấu hình trong VS Code Settings:

- `srv.aiReview.azureUrl`
  - endpoint Azure AI
- `srv.aiReview.azureKey`
  - API key
- `srv.aiReview.deploymentName`
  - tên model deployment, mặc định là `gpt-5.1-chat`

Những cấu hình này giúp extension hoạt động với môi trường Azure AI của người dùng.

---

## 5. Các command quan trọng

Extension đăng ký các command chính sau:

- `srv.reviewCode`
  - review file hiện tại bằng AI
- `srv.openDiff`
  - mở diff của file thay đổi
- `srv.applyFix`
  - áp dụng fix được AI đề xuất
- `srv.jumpToComment`
  - nhảy đến comment trong file
- `srv.refreshChangedFiles`
  - làm mới danh sách file thay đổi
- `srv.openSettings`
  - mở phần settings của extension

---

## 6. Kiến trúc các file trong `src`

### `extension.ts`

File trung tâm của extension, chịu trách nhiệm:

- khởi tạo command
- xử lý Git diff
- gọi AI
- render comment
- áp dụng fix

### `codelens.ts`

Tạo CodeLens **Apply Fix** cho từng comment review.

### `decoration.ts`

Render comment trực tiếp trên editor bằng decoration và tooltip.

### `diffParser.ts`

Phân tích unified diff và map line number từ AI sang dòng thực tế trong editor.

### `sidebar.ts`

Quản lý danh sách comment ở sidebar và cho phép click để điều hướng.

---

## 7. Điểm nổi bật của extension

- Review code ngay trong VS Code
- Kết hợp Git diff và AI để phát hiện vấn đề
- Hiển thị comment rõ ràng, trực quan
- Có nút Apply Fix để sửa nhanh
- Hỗ trợ sidebar và jump-to-comment
- Dễ cấu hình với Azure AI endpoint

---

## 8. Giá trị mang lại

Extension này giúp tăng hiệu suất làm việc cho developer bằng cách:

- giảm thời gian review thủ công
- phát hiện lỗi sớm hơn
- chuẩn hóa cách trình bày review
- hỗ trợ sửa code ngay từ gợi ý AI

Nói ngắn gọn: **SRV biến quá trình code review từ thủ công thành một workflow AI hỗ trợ trực tiếp trong VS Code.**
