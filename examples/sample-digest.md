# Tech Radar — 2026-09-23
_Illustrative example. The stories and dates below are placeholders and must never be copied into a real digest._
_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit · 43 domains scanned · 32 items_

## Featured this week

### A placeholder deep dive: what an open-weights release at this scale would change

This section is what a week that warrants a deep dive looks like: 200-350 words on what changed, why it matters, what it affects and what to watch next. The text here is placeholder prose that shows the shape rather than a real analysis.

A real deep dive names the artifact, its date and its primary source in the first two sentences, then explains the second-order effects: who can now do what they could not do last week, which competing approach it undercuts, and which of the run's ordinary items it reframes. It does not restate the headline at length, and it does not speculate past what the fetched sources support.

This example exists so that the shape is visible before the first real run is written. Every digest that ships a featured section fills it from fetched sources only, and a week that does not warrant one omits the section rather than padding it. A real deep dive names its artifact, its date and its primary source here; this placeholder carries a placeholder one instead, so the rendered card shows the linked headline, the marker dot and the origin pill an honest deep dive gets. [src:arXiv cs.CL listing 2026-09-18](https://example.org/preprints/open-weights) [prov:preprint] #new

## Core domains

### AI / LLM · 人工智能 / 大模型
- **某实验室发布新的开放权重模型，并把许可证改为允许商用** — 这次变化的关键在许可证：上一版需要单独申请商用授权，这一版把门槛直接取消；模型规模与评测数字仍来自发布方，需要独立复现才能当作结果。
  [src:DeepSeek and Qwen release blogs 2026-09-18](https://example.org/zh/open-weights) [prov:primary] #new
- **国内媒体比较了两家厂商的智能体协议扩展** — 报道指出互操作性仍取决于各自的私有扩展；这是一篇二手梳理，窗口内没有对应的规范更新。
  [src:量子位 2026-09-20](https://example.org/zh/agent-protocols) [prov:secondary] #followup
- **An inference runtime shipped a new batching scheduler** — The release targets long-context requests and reports lower tail latency; the numbers are the project's own and are not independently reproduced here.
  [src:Hugging Face blog 2026-09-21](https://example.org/en/batching-scheduler) [prov:primary] #new
- **A frontier lab restated its agent roadmap** — The post restates a capability timeline and ships no product in the window, so it is recorded as a claim rather than a result.
  [src:OpenAI release blog 2026-09-17](https://example.org/en/agent-roadmap) [prov:vendor-claim] #followup [alt:Independent analysis](https://example.net/notes/agent-roadmap)

### Chips, hardware and accelerators · 芯片、硬件与加速器
- **A placeholder accelerator roadmap slipped by a quarter** — Roadmap dates are vendor claims and not shipped products, so the slip is recorded as a claim; the part it replaces stays current until the new one ships.
  [src:NVIDIA newsroom and developer blog 2026-09-19](https://example.org/en/accelerator-roadmap) [prov:vendor-claim] #new
- **Two CPU vendors announced a shared platform generation** — The announcement covers sockets, memory support and a firmware baseline, and both vendors' own release notes are the primary record.
  [src:AMD and Intel newsrooms 2026-09-21](https://example.org/en/platform-generation) [prov:primary] #new
- **An independent analysis traced the packaging supply chain** — The report maps which steps have a single supplier and which have a second source; it is reporting, not a primary artifact.
  [src:IEEE Spectrum semiconductors 2026-09-22](https://example.org/en/packaging-supply) [prov:secondary] #followup

### Computer vision and perception · 计算机视觉与感知
- **A preprint reports a detector trained without box labels** — The listing reports gains on two benchmarks; as an unreviewed preprint this is written as a claim, not an established capability.
  [src:arXiv cs.CV listing 2026-09-16](https://example.org/preprints/cv-detector) [prov:preprint] #new
- **A vision library changed its default inference runtime** — The release note says the common path stays backwards compatible and lists the operators that still fall back.
  [src:OpenCV and ONNX Runtime release notes 2026-09-20](https://example.org/en/vision-runtime) [prov:primary] #followup

### Real-time graphics, engines and generative media · 实时图形、引擎与生成式媒体
- **A graphics API specification added a ray-tracing extension** — The extension is optional and lands in a ratified specification, so it is a primary artifact even though drivers will follow later.
  [src:Khronos and Vulkan release notes 2026-09-18](https://example.org/specs/rt-extension) [prov:primary] #new
- **An engine rewrote its rendering pipeline** — The release notes describe the new pass structure, the projects it breaks and the migration path, all in the same note.
  [src:Blender, Godot and Unreal release notes 2026-09-22](https://example.org/en/pipeline-rewrite) [prov:primary] #followup

### Self-hosting, local-first and privacy tech · 自托管、本地优先与隐私技术
- **A self-hosted project shipped the migration users had asked for** — The release moves the database schema in place and documents a rollback, so the release note is the artifact.
  [src:Home Assistant, Immich and Jellyfin releases 2026-09-19](https://example.org/en/schema-migration) [prov:primary] #new
- **A local inference runtime added a quantisation format** — The runtime now reads a 4-bit format it previously converted on load, which shortens cold starts on the same hardware.
  [src:llama.cpp and Ollama releases 2026-09-21](https://example.org/en/quantisation) [prov:primary] #followup

### Energy and power · 能源与电力
- **A storage vendor announced a certified cell for its shipping product** — The certification is named but the test report is not public, so the claim is recorded as a vendor claim rather than a verified result.
  [src:Battery and solar vendor technical blogs 2026-09-17](https://example.org/en/certified-cell) [prov:vendor-claim] #new
- **An energy agency published its storage outlook** — The outlook revises deployment assumptions for the next three years and states its own uncertainty range.
  [src:IEA and NREL publications 2026-09-20](https://example.org/reports/storage-outlook) [prov:primary] #followup
- **A preprint measures a cathode chemistry in coin cells** — A coin-cell measurement is a claim and not a shipping product, and the listing is unreviewed.
  [src:arXiv and Joule research listings 2026-09-16](https://example.org/preprints/cathode) [prov:preprint] #new

### Materials and advanced manufacturing · 材料与先进制造
- **A journal reports an independent replication of a superconductor measurement** — Independent replication is what the hype rule asks for before the result is stated as one.
  [src:Nature Materials and Science coverage 2026-09-18](https://example.org/journals/replication) [prov:secondary] #new
- **A preprint reports a single-sample measurement of the same class of material** — One sample from one laboratory is a claim, and the preprint is tagged as unreviewed.
  [src:arXiv cond-mat.mtrl-sci listing 2026-09-17](https://example.org/preprints/single-sample) [prov:preprint] #followup

### Robotics and autonomy · 机器人与自主系统
- **Units from a warehouse robotics vendor are running a commercial task** — A deployed unit doing the task commercially is what the hype rule accepts as a result, and the vendor's release note is the record.
  [src:ROS and vendor release notes 2026-09-21](https://example.org/en/deployed-units) [prov:primary] #new
- **A preprint reports a manipulation policy reproduced outside the lab that built it** — The reproduction is by a second group, which is the condition the hype rule sets.
  [src:arXiv cs.RO listing 2026-09-19](https://example.org/preprints/manipulation) [prov:preprint] #followup

### Industrial automation and OT · 工业自动化与运营技术
- **OT advisories named three controllers with remotely reachable flaws** — The advisories list the affected firmware versions and the mitigations that do not require a patch.
  [src:CISA ICS advisories 2026-09-22](https://example.org/advisories/ics) [prov:primary] #new
- **A functional-safety standard revision entered a second comment round** — The draft is a primary document, and the timetable to publication is not yet fixed.
  [src:ISA and IEC 62443 updates 2026-09-17](https://example.org/standards/62443) [prov:primary] #followup

### Transport and mobility · 交通与出行
- **A transport research body published new charging-utilisation data** — The dataset covers public chargers by region and states its collection method.
  [src:IEA Global EV Outlook and ICCT publications 2026-09-20](https://example.org/reports/charging-data) [prov:primary] #new
- **Industry reporting described a freight electrification programme** — The report is secondary, and no primary programme document was retrievable in the window.
  [src:Automotive World and electrive 2026-09-18](https://example.org/news/freight) [prov:secondary] #followup

### Neuroscience and brain-computer interfaces · 神经科学与脑机接口
- **A BCI company posted an update about its participant count** — There is no peer-reviewed cohort and no regulatory clearance in the window, so the update is a vendor claim and not a result.
  [src:Neuralink 2026-09-19](https://example.org/en/participant-update) [prov:vendor-claim] #new
- **A preprint reports a neural-decoding result from a named cohort** — The cohort is named and the decoding target is stated; as a preprint it is a claim until it is reviewed.
  [src:arXiv q-bio.NC listing 2026-09-16](https://example.org/preprints/decoding) [prov:preprint] #followup

### Wearables, sensors and human augmentation · 可穿戴、传感器与人体增强
- **A device clearance covered a continuous-monitoring sensor** — A clearance is a regulatory artifact, so the clearance notice is the primary citation.
  [src:FDA device clearances and vendor release notes 2026-09-21](https://example.org/clearances/sensor) [prov:primary] #new
- **A vendor posted accuracy figures for a prototype** — A prototype and a vendor accuracy figure are explicitly not a result under the hype rule, so this stays a claim.
  [src:FDA device clearances and vendor release notes 2026-09-17](https://example.org/en/prototype-accuracy) [prov:vendor-claim] #followup

### Defence and dual-use technology · 国防与两用技术
- **A procurement notice confirmed a programme milestone** — Official programme documentation is what the hype rule accepts, and the notice is the primary artifact.
  [src:Government defence procurement announcements 2026-09-20](https://example.org/notices/programme) [prov:primary] #new
- **An independent assessment disputes a counter-drone capability claim** — The assessment is paywalled, so it is cited link-only with a fetchable corroboration rather than paraphrased from the headline.
  [src:Janes and IISS analysis 2026-09-16](https://example.org/janes/counter-drone) [prov:secondary] #followup [alt:Industry coverage](https://example.net/coverage/counter-drone)

### Audio, speech and music technology · 音频、语音与音乐技术
Scanned, nothing notable this week. Nothing cleared the evidence bar, so the domain keeps its heading and says so rather than being padded.

## Watch domains — notable this week

### Security and privacy · 安全与隐私
- **An advisory covered a parser used across many products** — The advisory names the affected ranges and the fixed release, and it is the primary record.
  [src:GitHub Security Advisories and NVD 2026-09-22](https://example.org/advisories/parser) [prov:primary] #new
- **A vendor's incident write-up described the same class of flaw** — The write-up is a primary account from the party that fixed it, not an independent assessment.
  [src:Google Project Zero blog 2026-09-21](https://example.org/en/incident-writeup) [prov:primary] #followup

## Watch domains — quiet
Photonics and optical interconnects · Quantum technologies · EDA and open silicon · Scientific computing and HPC · Languages and runtimes · Developer tools and editors · Web platform and browsers · Open source governance and licensing · Formal methods and program verification · Linux and operating systems · Infrastructure, cloud and orchestration · Data, databases and storage · Networking and telecom · Smart home and IoT protocols · Personal computing and devices · Tech policy, standards and regulation · Built environment and construction technology · Climate and earth observation · Ocean, water and critical resources · Power electronics · Supply chains and logistics technology · Simulation and computer-aided engineering · Biotech and health · Frontier science and fundamental research · Space and aerospace · Fintech and payment rails · Spatial computing, AR/VR and displays · HCI and interaction research (all scanned, nothing notable this week)

## Coming up
- A licence clarification is disputed by two downstream projects; a statement is expected within two weeks.
- The advisory's fix has not reached every distribution; an updated build is expected within a month.
- The preprinted result has been submitted to a venue; a decision is expected before the next quarter.

## Coverage note
Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit

Illustrative example: every story, date and URL above is a placeholder, and the outlet names are real entries from `config/sources.md`. A real digest repeats the plan's window label here verbatim, states what the cap skipped, and carries the collector's notices. This run scanned 14 core domains and 29 watch domains, shipped 32 items, and names the 28 watch domains that produced nothing on the quiet line. No domain was clipped by the cap. Collector notices: none, because this example collected nothing.

## Sources
Registry and discovery surfaces are listed in `config/sources.md`; discovery surfaces are never cited. The four provenance markers are `[prov:primary]`, `[prov:secondary]`, `[prov:preprint]` and `[prov:vendor-claim]`; every item carries exactly one of them and exactly one of `#new` and `#followup`.
