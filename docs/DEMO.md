# Kịch bản demo 3 phút — CareerPilot

**Thông điệp chính:** một người dùng mới tự tạo tài khoản, bắt đầu với hồ sơ trống, khai background và trả lời discovery để tìm hướng đi. Thiếu bằng chứng kỹ năng thì ghi *Unknown*, không bịa số.

## Quay video đúng 3 phút

Chạy `npx playwright install ffmpeg` một lần, sau đó `npm run demo:record` (cần Chrome, `ffmpeg` và `ffprobe` trong PATH). Lệnh tự khởi động app và AI giả lập, quay 6 cảnh, xuất `e2e/videos/<timestamp>/careerpilot-demo-3min.mp4`. Video không có âm thanh; có thể thu lời dẫn riêng theo các mốc bên dưới. AI coaching dùng mock cục bộ để lần quay ổn định; dữ liệu thị trường dùng fixture qua mock server, tin phỏng vấn là tin Demo có nhãn.

Video có chú thích **tiếng Anh** theo từng phần, cuộn mượt để giới thiệu nội dung và chuyển cảnh crossfade 0,4 giây. Phần đăng ký nhập từng ký tự, có nhịp dừng để đọc và giới thiệu. Các đoạn chờ còn lại được dùng để xem các phần tiếp theo, không giữ nguyên một màn hình trống hoạt động.

Sáu cảnh được phân bổ 30 / 40 / 30 / 25 / 40 / 15 giây. Khi xuất, toàn bộ cảnh được căn về thời lượng được cấp; crossfade chồng tổng cộng 2 giây được bù bằng 2 giây giữ phần kết để đọc. File MP4 được kiểm tra bằng ffprobe: **180.000 giây, 4500 frame, 25 fps, 1440 × 900**. `verified.json` lưu kết quả kiểm tra và mã SHA-256 của source web/API; `scenes.json` và clip gốc giữ lại để xem lại. Web và API luôn khởi động mới từ source hiện tại, không dùng lại server cũ. Nếu source thay đổi trong lúc quay, lệnh báo lỗi để quay lại bản mới nhất. Chỉ xuất video khi toàn bộ assertion pass.

Toàn bộ video dùng **dark mode**; test kiểm tra `data-theme="dark"` ở từng cảnh. Tài khoản được đăng ký qua giao diện, không gọi API nạp sample profile. Test chặn endpoint sample để tránh vô tình dùng dữ liệu mẫu cá nhân. Catalog nghề, roadmap và tin Demo là dữ liệu chung của hệ thống, không phải dữ liệu cá nhân được nạp sẵn.

Luồng này được kiểm thử tự động bởi [`e2e/tests/12-demo.spec.ts`](../e2e/tests/12-demo.spec.ts) — mỗi bước click dưới đây đều có trong test.

## Trước buổi demo (T-30 phút)

| # | Việc | Lệnh / cách làm |
|---|------|-----------------|
| 1 | Tập dượt tự động — phải **pass** | `npm run demo:rehearse` (≈ 1 phút, DB trắng + AI giả lập) |
| 2 | Xem lại nhịp trình bày (tùy chọn) | `npm run demo:auto` — mở trình duyệt, tự chạy với nhịp chậm |
| 3 | Chạy app thật | `npm run dev` → http://localhost:5173 |
| 4 | Đã có key AI trong Settings (hoặc `.env`) | Không có key → app vẫn chạy bằng heuristic, nhưng mất phần *AI coaching* |
| 5 | Đồng bộ dữ liệu thị trường | Trang **Jobs** → *Sync now* (Cert Trends) |
| 6 | Bắt đầu ở màn hình đăng ký, chưa có tài khoản | Để bước 1 làm trực tiếp |
| 7 | Mở sẵn 1 tab dự phòng đã đi hết luồng | Dùng khi mạng/AI chậm |

Trình duyệt: zoom 110–125%, ẩn bookmark bar, tắt thông báo.

## Kịch bản

| Thời gian | Màn hình | Thao tác | Lời thoại (gợi ý) |
|-----------|----------|----------|-------------------|
| **0:00–0:30** | `/` → `/welcome` | Nhập chậm Minh, email, mật khẩu → **Create account** → cuộn qua guide | "Minh lần đầu vào CareerPilot, chưa có hồ sơ hay kỹ năng. Minh tạo tài khoản để tìm hướng chuyển nghề." |
| **0:30–1:10** | `/interviews/new?mode=discovery` | Khai background → 8 câu trắc nghiệm → áp dụng → xem các gợi ý và khoảng trống | "Minh tự khai background và trả lời 8 câu hỏi. Đáp án thành gợi ý, Minh xem lại rồi mới áp dụng." |
| **1:10–1:40** | `/matching?role=ai-engineer` | Cuộn từ 4 chiều matching đến transferable skills, bảng kỹ năng và các bước tiếp theo | "Bốn chiều tính độc lập. RAG ghi Unknown vì Minh chưa có bằng chứng." |
| **1:40–2:05** | `/market` | Drill-down Active → cuộn qua lịch sử, tín hiệu hiện tại và độ mới nguồn dữ liệu | "Mở số liệu để kiểm tra tin tuyển dụng đứng sau nó, sau đó xem giới hạn dữ liệu." |
| **2:05–2:45** | Job Demo → Mock interview → report | Phỏng vấn kỹ thuật → xem rubric → coaching → cuộn transcript và tip | "Match và luyện theo JD cụ thể. AI coaching giải thích, không sửa điểm." |
| **2:45–3:00** | `/roadmap/ai-engineer` | Cuộn qua các node khóa / cần assessment | "Khoảng trống biến thành lộ trình: học, làm bài, và kỹ năng chỉ được *verified* khi qua assessment. Cảm ơn mọi người." |

Câu trả lời mẫu cho bước phỏng vấn (copy sẵn vào clipboard):

> First I clarified the goal because users reported slow checkouts. Then I measured latency, I proposed a cache and we cut p95 latency noticeably. I learned to measure before optimizing and would add alerts next time.

## Nếu có sự cố

| Tình huống | Xử lý |
|------------|-------|
| AI chậm hoặc lỗi | App tự chuyển sang heuristic và ghi nhãn rõ. Nói: "khi AI lỗi, hệ thống báo rõ chứ không giấu" rồi đi tiếp |
| Market trống | Bật *Include demo postings*, hoặc bỏ cảnh này (tiết kiệm 25 giây) |
| Bị trễ giờ | Bỏ cảnh Market trước, sau đó cắt bớt cảnh Roadmap |
| Hỏng hẳn | Chuyển sang tab dự phòng, hoặc chạy `npm run demo:auto` |

## Kịch bản test đi kèm

| Lệnh | Phạm vi |
|------|---------|
| `npm run demo:rehearse` | Chỉ luồng demo (DEMO-01), headless |
| `npm run demo:record` | Quay và xuất MP4 đúng 180 giây, kiểm tra thời lượng và số frame |
| `npm run demo:auto` | Trình duyệt hiển thị, nhịp 6 cảnh theo lịch 3 phút; thời gian thực tế có thể tăng nếu máy chậm |
| `npm test` | API: luồng chấp nhận đầy đủ, gồm discovery trắc nghiệm + background, drill-down thị trường |
| `npm run test:e2e` | Toàn bộ trình duyệt, gồm TC-INT-02 (discovery), TC-SMK-03 (popup Market), DEMO-01 |
