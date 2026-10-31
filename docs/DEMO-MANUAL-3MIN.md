# CareerPilot — tự quay video giới thiệu đúng 3 phút

Dark mode · 1440 × 900 hoặc 1920 × 1080 · lời dẫn/chú thích tiếng Anh.

## Chuẩn bị trước khi bấm quay

1. Chạy web/API hiện tại bằng `npm run dev`, mở http://localhost:5173. Nếu app đang chạy thì giữ nguyên.
2. Cửa sổ thường: để ở landing page, chưa đăng nhập. Tạo tài khoản mới khi quay; không chọn **Load sample profile**.
3. Cửa sổ **ẩn danh hoặc profile trình duyệt khác**: đăng nhập tài khoản Tracker demo bằng email/mật khẩu trong [file thông tin cục bộ](../.data/demo-tracker.json). Không dùng hai tab cùng profile vì chúng chia sẻ cookie đăng nhập.
4. Trong cửa sổ demo, mở sẵn `/applications`, chọn **Kanban**. Mở thêm tab trang chi tiết một hồ sơ ở **Interview** (đường dẫn `interviewUrl` trong file trên).
5. Bật dark mode ở cả hai cửa sổ, tắt thông báo và ẩn bookmark bar. Đừng quay lúc copy mật khẩu.
6. Bấm thử Market và kiểm tra đã có dữ liệu. Chuẩn bị sẵn một báo cáo mock interview nếu AI có thể chậm. Khi chuyển sang dữ liệu chuẩn bị sẵn, giới thiệu rõ là ví dụ.
7. Đặt đồng hồ đếm ngược **3:00**. Mỗi mốc dưới đây là điểm phải chuyển cảnh; vừa thao tác vừa đọc lời dẫn, không đọc xong mới click.

## Shot list — tổng cộng 180 giây

| Mốc | Thao tác quay | Lời dẫn / chú thích tiếng Anh |
|---|---|---|
| **0:00–0:25** — 25s | Landing 3 giây → cuộn nhẹ tới form → nhập chậm tên, email, mật khẩu → **Create account** → Welcome. | “CareerPilot connects career exploration, skill evidence, learning and job applications in one workspace. I’m starting as a new user, with an empty profile. Let’s create an account and follow the getting-started guide.” |
| **0:25–0:55** — 30s | Discovery: *Working in tech*, *Backend Engineer*, *5 years* → trả lời 8 câu → xem gợi ý → **Apply to my profile**. Cuộn tới *Top 3 Career Matches* và *Potential Skill Gaps*. | “Career discovery starts with my background, interests and learning capacity. It suggests directions I can explore, then lets me review the profile updates before applying them. These answers describe my preferences; they do not verify my technical skills.” |
| **0:55–1:20** — 25s | `/matching?role=ai-engineer`: xem 4 chiều → cuộn xuống transferable skills và bảng yêu cầu → dừng ở RAG: **Unknown**. | “Role matching separates capability, interest, growth and market opportunity. I can inspect transferable skills and compare my evidence with each requirement. Unknown means there isn’t enough evidence yet. It is not a zero score, or a prediction of being hired.” |
| **1:20–1:40** — 20s | Market: bấm **Active** → mở một breakdown → xem nguồn → Esc → cuộn xuống lịch sử và độ mới dữ liệu. | “Market figures open the postings behind them. I can drill into the source, then check historical observations, current signals and freshness. These numbers describe the collected dataset, so source coverage matters.” |
| **1:40–2:10** — 30s | Job Demo AI Engineer → **Your match** → **Mock interview**, Technical → Build blueprint → Start → nhập câu trả lời ngắn → Submit → End & get report. Xem rubric, coaching; cuộn xuống transcript. | “A specific job connects the requirements to interview practice. I can answer one question at a time, then review the rubric, coaching and feedback on each answer. Coaching explains how to improve; it does not change the practice score.” |
| **2:10–2:30** — 20s | `/roadmap/ai-engineer`: cho xem graph 4 giây → bấm Python → cuộn drawer qua Learning outcome, Practice task, Resources. | “The roadmap turns a direction into concrete next steps. Each node shows the learning outcome, a practice task and resources. Skills need assessment evidence; completing a course alone does not make them verified.” |
| **2:30–2:55** — 25s | Chuyển cửa sổ ẩn danh đã có Tracker demo. Kanban 7 giây → mở hồ sơ Interview 8 giây, xem vòng phỏng vấn, follow-up, timeline → quay lại Tracker, bấm Analytics 10 giây. | “Here is a fictional application pipeline prepared for this demo. The tracker organizes stages, follow-ups, interview rounds and the activity timeline. Analytics summarizes the pipeline. CareerPilot tracks the process; it does not submit applications or contact companies for me.” |
| **2:55–3:00** — 5s | Giữ màn hình Tracker hoặc chuyển về Dashboard; hiện dòng kết. | “Explore a direction. Build the evidence. Take the next step.” |

## Nhịp quay

- Cuộn chậm 1–2 nhịp, dừng 2–3 giây tại tiêu đề hoặc thẻ đang giải thích. Không cuộn liên tục khi người xem đang đọc.
- Với chú thích, chia lời dẫn thành từng câu; mỗi khung tối đa 1–2 dòng. Không đưa cả đoạn văn lên cùng lúc.
- Nếu chậm ở Discovery, chỉ cuộn xem *Top 3 Career Matches* rồi đi tiếp. Nếu AI chậm, chuyển sang báo cáo chuẩn bị sẵn và nói “Here is a prepared example report.” Không chờ loading quá 3–5 giây.
- Đến **2:30** phải chuyển sang Tracker; đến **2:55** phải vào câu kết. Dừng ghi ở **3:00**.

## Dữ liệu Application Tracker đã tạo

- **10 hồ sơ**, tất cả liên kết tới job có nhãn **Demo**, công ty hư cấu.
- Saved **2**, Applied **2**, Screening **1**, Assessment **1**, Interview **2**, Offer **1**, Closed **1** (Accepted).
- Có lịch phỏng vấn/assessment, ngày follow-up, contact dùng miền `.example`, ghi chú và timeline.
- Tài khoản không được nạp sample profile. Chỉ tạo dữ liệu Tracker theo yêu cầu. Thời gian tạo/chuyển stage là thời gian seed thực tế, không giả lịch sử nhiều tuần.
- Không gửi đơn ứng tuyển, không gửi email hoặc liên hệ công ty.
- Chạy lại `npm run demo:seed-tracker` để kiểm tra/tạo lại phần còn thiếu; các job đã được theo dõi không bị tạo trùng.
- Thông tin đăng nhập: [`.data/demo-tracker.json`](../.data/demo-tracker.json), chỉ lưu cục bộ; không đưa file này vào video hay chia sẻ công khai.
