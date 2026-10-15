# Source feasibility — the probe evidence

**Probe date: 2026-09-23** (Asia/Shanghai). Every row below was probed or assessed on that date, and no
other date appears as a probe date in this file.

This file is the evidence behind the `fetchable` column of `config/sources.md`. It records what automated
fetch actually achieved, so a later reader can tell which claims were tested rather than assumed.

## How the rows were probed

- **Transport.** The fetch helper the collectors use, `scripts/lib/net.mjs` `fetchText`, with a 15 s
  timeout and the default user agent `tech-radar/1.0`. This is the transport the collector itself runs on,
  so a failure here is a failure a run would also see. The four hosts that answered 403 were probed a second
  time with the configured `user_agent` from `config/settings.md`; all four answered 403 again, so the block
  is not an artefact of the short user agent.
- **One URL per row.** `config/sources.md` names *outlets*, not URLs — its columns are
  `domain, source, tier, kind, lang, fetchable, note` and it has no URL column. Each row was therefore probed
  at one representative page: the first publication the row names, at its canonical news or index path. That
  URL is named in the `url probed` column, and the result is evidence about *that page*. A row that names
  several outlets was probed at one of them only; the other named outlets were not probed individually.
- **Retries.** A 404 was treated as a bad URL choice first, not as a finding: where a path 404'd, a corrected
  path or the site root was tried and the table records the corrected URL and the outcome. A 403, by contrast,
  is the source refusing the client, and was retried only to rule out the user agent.
- **Live collectors.** Separately from the per-row pages, the real collectors were run against
  `config/watchlist.md` on the same date (see *Live collector runs* below).
- **Honesty rule.** Where a row names no publication and no URL, and no collector target exists for it, the
  entry says so and the result is `not addressed`. Nothing in this file is inferred from a neighbouring row.

**A permission failure is not a source defect.** A 401, 403 or 429 says that this client was not allowed to
read that page on that date — a paywall, a bot filter or a rate limit. It is recorded as a property of the
source, never as a defect in our code, and the source's editorial standing is unaffected.

## Probe table

One row per row of `config/sources.md`, in registry order. `fetchable (as registered)` is the value the
registry carried during the probe; for the rows added in this pass it is the value they were added with, and
the *Corrections* section lists every value changed afterwards. `probe date` is the date of this pass: for a
row whose result is `not addressed` it records when the row was assessed as having no page to probe, not a
successful fetch.

| domain | source | fetchable (as registered) | url probed | http | result | probe date |
|---|---|---|---|---|---|---|
| ai-llm | arXiv cs.CL and cs.AI listings | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.CL | 200 | readable | 2026-09-23 |
| ai-llm | Hugging Face blog | yes | https://huggingface.co/blog | 200 | readable (303704 B) | 2026-09-23 |
| ai-llm | OpenAI, Anthropic, Google DeepMind, Meta AI release blogs | yes | https://openai.com/news/ | 403 | blocked at openai.com; anthropic.com/news returned 200 | 2026-09-23 |
| ai-llm | DeepSeek | yes | https://api-docs.deepseek.com/news/ | 200 | readable (45795 B); served page is Latin-only (4 CJK characters) | 2026-09-23 |
| ai-llm | Qwen release blogs | yes | https://qwenlm.github.io/blog/ | 200 | readable (13796 B); served page is Latin-only | 2026-09-23 |
| ai-llm | 机器之心 | yes | https://www.jiqizhixin.com/ | 200 | not readable: client-rendered shell, no article content (12601 B) | 2026-09-23 |
| ai-llm | 量子位 | yes | https://www.qbitai.com/2026/09/496609.html | 200 | readable (article page: 50314 B, 20 paragraphs, 2253 CJK characters); homepage 200 (63058 B) is a title-link index with no <article> or <h2>; /feed 200 (5494 B, 10 RSS items) | 2026-09-23 |
| ai-llm | vLLM releases | yes | https://api.github.com/repos/vllm-project/vllm/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | Transformers releases | yes | https://api.github.com/repos/huggingface/transformers/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | PyTorch releases | yes | https://api.github.com/repos/pytorch/pytorch/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | DeepSeek releases | yes | https://api.github.com/repos/deepseek-ai/DeepSeek-V3/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | Qwen releases | yes | https://api.github.com/repos/QwenLM/Qwen3/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | OpenAI Python releases | yes | https://api.github.com/repos/openai/openai-python/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | Model Context Protocol releases | yes | https://api.github.com/repos/modelcontextprotocol/servers/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| ai-llm | arXiv cs.AI listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.AI | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| ai-llm | arXiv cs.CL listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.CL | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| ai-llm | arXiv cs.LG listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.LG | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| ai-llm | PyPI torch | yes | https://pypi.org/pypi/torch/json | 200 | readable (pypi registry collector, 0 notices) | 2026-09-23 |
| ai-llm | PyPI transformers | yes | https://pypi.org/pypi/transformers/json | 200 | readable (pypi registry collector, 0 notices) | 2026-09-23 |
| chips-hardware | NVIDIA newsroom and developer blog | yes | https://developer.nvidia.com/blog/ | 200 | readable (360154 B) | 2026-09-23 |
| chips-hardware | AMD, Intel newsrooms | yes | https://www.amd.com/en/newsroom.html | 200 | readable (119244 B) | 2026-09-23 |
| chips-hardware | IEEE Spectrum semiconductors | yes | https://spectrum.ieee.org/semiconductors | 200 | readable (446480 B) | 2026-09-23 |
| chips-hardware | Taiwan and Korea trade press | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| chips-hardware | NVIDIA CUDA samples releases | yes | https://api.github.com/repos/NVIDIA/cuda-samples/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| chips-hardware | arXiv cs.AR listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.AR | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| computer-vision | arXiv cs.CV listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.CV | 200 | readable | 2026-09-23 |
| computer-vision | CVPR, ICCV, ECCV proceedings pages | yes | https://openaccess.thecvf.com/ | 200 | readable (9111 B) | 2026-09-23 |
| computer-vision | OpenCV, ONNX Runtime release notes | yes | https://github.com/opencv/opencv/releases | 200 | readable (472716 B) | 2026-09-23 |
| computer-vision | OpenCV releases | yes | https://api.github.com/repos/opencv/opencv/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/opencv/opencv/releases 200 (472716 B) | 2026-09-23 |
| computer-vision | Ultralytics releases | yes | https://api.github.com/repos/ultralytics/ultralytics/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| computer-vision | COLMAP releases | yes | https://api.github.com/repos/colmap/colmap/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| photonics | Nature Photonics, Optica news | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| photonics | Co-packaged optics vendor blogs | yes | -- | -- | not addressed: the row names no publication and no URL | 2026-09-23 |
| quantum | arXiv quant-ph listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:quant-ph | 200 | readable | 2026-09-23 |
| quantum | Nature, Science quantum coverage | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| quantum | IBM, Google Quantum AI, IonQ blogs | yes | https://www.ibm.com/quantum/blog | 200 | readable (91613 B) | 2026-09-23 |
| eda-silicon | Yosys, OpenROAD, RISC-V project releases | yes | https://github.com/YosysHQ/yosys/releases | 200 | readable (413224 B) | 2026-09-23 |
| eda-silicon | SemiEngineering | yes | https://semiengineering.com/ | 200 | readable (819631 B) | 2026-09-23 |
| eda-silicon | Yosys releases | yes | https://api.github.com/repos/YosysHQ/yosys/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/YosysHQ/yosys/releases 200 (413224 B) | 2026-09-23 |
| eda-silicon | OpenROAD releases | yes | https://api.github.com/repos/The-OpenROAD-Project/OpenROAD/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| eda-silicon | RISC-V ISA simulator releases | yes | https://api.github.com/repos/riscv-software-src/riscv-isa-sim/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| hpc-scientific | arXiv cs.DC listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.DC | 200 | readable | 2026-09-23 |
| hpc-scientific | TOP500 and exascale centre announcements | yes | https://www.top500.org/ | 200 | readable (76403 B) | 2026-09-23 |
| hpc-scientific | NumPy, SciPy, JAX release notes | yes | https://github.com/numpy/numpy/releases | 200 | readable (628066 B) | 2026-09-23 |
| hpc-scientific | NumPy releases | yes | https://api.github.com/repos/numpy/numpy/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/numpy/numpy/releases 200 (628066 B) | 2026-09-23 |
| hpc-scientific | JAX releases | yes | https://api.github.com/repos/google/jax/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| hpc-scientific | XLA releases | yes | https://api.github.com/repos/openxla/xla/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | Node, Python, Rust, Go, TypeScript release notes | yes | https://nodejs.org/en/blog | 200 | readable (828741 B) | 2026-09-23 |
| languages-runtimes | TC39, PEP, Rust RFC indexes | yes | https://github.com/tc39/proposals | 200 | readable (389786 B) | 2026-09-23 |
| languages-runtimes | Node.js releases | yes | https://api.github.com/repos/nodejs/node/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | CPython releases | yes | https://api.github.com/repos/python/cpython/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | Rust releases | yes | https://api.github.com/repos/rust-lang/rust/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | Go releases | yes | https://api.github.com/repos/golang/go/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | TypeScript releases | yes | https://api.github.com/repos/microsoft/TypeScript/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | Deno releases | yes | https://api.github.com/repos/denoland/deno/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | Bun releases | yes | https://api.github.com/repos/oven-sh/bun/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| languages-runtimes | arXiv cs.PL listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.PL | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| languages-runtimes | npm typescript | yes | https://registry.npmjs.org/typescript | 200 | readable (npm registry collector, 0 notices) | 2026-09-23 |
| languages-runtimes | crates.io tokio | yes | https://crates.io/api/v1/crates/tokio | 200 | readable (crates registry collector, 0 notices) | 2026-09-23 |
| languages-runtimes | crates.io serde | yes | https://crates.io/api/v1/crates/serde | 200 | readable (crates registry collector, 0 notices) | 2026-09-23 |
| languages-runtimes | Rust blog | yes | https://blog.rust-lang.org/2026/09/22/announcing-a-maintainer-in-residence-scott-schafer-for-the-cargo-team/ | 200 | readable (article page: 14468 B, 13 paragraphs); feed blog.rust-lang.org/feed.xml 200 (134030 B, 10 items) | 2026-09-23 |
| languages-runtimes | Node.js release blog | yes | https://nodejs.org/en/blog/release/v26.10.0 | 200 | readable (article page: 434919 B, 4 paragraphs); feed nodejs.org/en/feed/blog.xml 200 (322295 B, 1056 items) | 2026-09-23 |
| devtools | VS Code, Neovim, Zed release notes | yes | https://code.visualstudio.com/updates | 200 | readable (first attempt 500, transient) | 2026-09-23 |
| devtools | LSP, Tree-sitter specifications | yes | https://microsoft.github.io/language-server-protocol/ | 200 | readable (43752 B) | 2026-09-23 |
| devtools | VS Code releases | yes | https://api.github.com/repos/microsoft/vscode/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| devtools | Neovim releases | yes | https://api.github.com/repos/neovim/neovim/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| devtools | Zed releases | yes | https://api.github.com/repos/zed-industries/zed/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| devtools | Tree-sitter releases | yes | https://api.github.com/repos/tree-sitter/tree-sitter/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| devtools | npm vite | yes | https://registry.npmjs.org/vite | 200 | readable (npm registry collector, 0 notices) | 2026-09-23 |
| devtools | PyPI pydantic | yes | https://pypi.org/pypi/pydantic/json | 200 | readable (pypi registry collector, 0 notices) | 2026-09-23 |
| web-platform | Chrome, Firefox, Safari release notes | yes | https://developer.chrome.com/blog | 200 | readable (90163 B) | 2026-09-23 |
| web-platform | W3C news, WHATWG commits | yes | https://www.w3.org/news/ | 200 | readable (41549 B) | 2026-09-23 |
| web-platform | TC39 proposals releases | yes | https://api.github.com/repos/tc39/proposals/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| web-platform | WHATWG HTML releases | yes | https://api.github.com/repos/whatwg/html/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| web-platform | npm react | yes | https://registry.npmjs.org/react | 200 | readable (npm registry collector, 0 notices) | 2026-09-23 |
| oss-governance | Software Freedom Conservancy, OSI announcements | yes | https://sfconservancy.org/news/ | 200 | readable (24547 B) | 2026-09-23 |
| oss-governance | OpenSSF blog | yes | https://openssf.org/blog/ | 200 | readable (122436 B) | 2026-09-23 |
| graphics-media | Khronos, Vulkan release notes | yes | https://www.khronos.org/news/ | 200 | readable (48845 B) | 2026-09-23 |
| graphics-media | Blender, Godot, Unreal release notes | yes | https://godotengine.org/blog/ | 200 | readable (34281 B) | 2026-09-23 |
| graphics-media | arXiv cs.GR listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.GR | 200 | readable | 2026-09-23 |
| graphics-media | Godot releases | yes | https://api.github.com/repos/godotengine/godot/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| graphics-media | Vulkan releases | yes | https://api.github.com/repos/KhronosGroup/Vulkan-Docs/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| formal-methods | Lean, Coq, Isabelle release notes | yes | https://github.com/leanprover/lean4/releases | 200 | readable (406735 B) | 2026-09-23 |
| formal-methods | arXiv cs.LO and cs.SE listings | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.LO | 200 | readable | 2026-09-23 |
| formal-methods | Lean releases | yes | https://api.github.com/repos/leanprover/lean4/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/leanprover/lean4/releases 200 (406735 B) | 2026-09-23 |
| formal-methods | arXiv cs.LO listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.LO | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| linux-os | LWN kernel coverage | feed-only | https://lwn.net/headlines/newrss | 200 | readable | 2026-09-23 |
| linux-os | kernel.org releases, systemd releases | yes | https://www.kernel.org/ | 200 | readable (20359 B) | 2026-09-23 |
| linux-os | Distro release announcements | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| linux-os | Linux kernel releases | yes | https://api.github.com/repos/torvalds/linux/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| linux-os | systemd releases | yes | https://api.github.com/repos/systemd/systemd/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| infra-cloud | CNCF, Kubernetes release notes | yes | https://kubernetes.io/blog/ | 200 | readable (487997 B) | 2026-09-23 |
| infra-cloud | AWS, Google Cloud, Azure changelogs | yes | https://aws.amazon.com/new/ | 200 | readable (352096 B) | 2026-09-23 |
| infra-cloud | Kubernetes releases | yes | https://api.github.com/repos/kubernetes/kubernetes/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| infra-cloud | containerd releases | yes | https://api.github.com/repos/containerd/containerd/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| infra-cloud | Moby releases | yes | https://api.github.com/repos/moby/moby/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| infra-cloud | PyPI fastapi | yes | https://pypi.org/pypi/fastapi/json | 200 | readable (pypi registry collector, 0 notices) | 2026-09-23 |
| infra-cloud | crates.io axum | yes | https://crates.io/api/v1/crates/axum | 200 | readable (crates registry collector, 0 notices) | 2026-09-23 |
| infra-cloud | Go modules k8s.io/client-go | yes | https://proxy.golang.org/k8s.io/client-go/@latest | 200 | readable (gomod registry collector, 0 notices) | 2026-09-23 |
| infra-cloud | Go modules github.com/prometheus/client_golang | yes | https://proxy.golang.org/github.com/prometheus/client_golang/@latest | 200 | readable (gomod registry collector, 0 notices) | 2026-09-23 |
| data-storage | PostgreSQL, DuckDB, ClickHouse release notes | yes | https://www.postgresql.org/ | 200 | readable (the first URL tried, /about/news/, is 404) | 2026-09-23 |
| data-storage | Apache Iceberg and Arrow release notes | yes | https://arrow.apache.org/blog/ | 200 | readable (127844 B) | 2026-09-23 |
| data-storage | DuckDB releases | yes | https://api.github.com/repos/duckdb/duckdb/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| data-storage | ClickHouse releases | yes | https://api.github.com/repos/ClickHouse/ClickHouse/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| data-storage | Apache Iceberg releases | yes | https://api.github.com/repos/apache/iceberg/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| data-storage | Apache Arrow releases | yes | https://api.github.com/repos/apache/arrow/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| self-hosting | Home Assistant, Immich, Jellyfin releases | yes | https://github.com/home-assistant/core/releases | 200 | readable (558928 B) | 2026-09-23 |
| self-hosting | llama.cpp, Ollama releases | yes | https://github.com/ggml-org/llama.cpp/releases | 200 | readable (503614 B) | 2026-09-23 |
| self-hosting | llama.cpp releases | yes | https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/ggml-org/llama.cpp/releases 200 (503614 B) | 2026-09-23 |
| self-hosting | Ollama releases | yes | https://api.github.com/repos/ollama/ollama/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| self-hosting | Home Assistant releases | yes | https://api.github.com/repos/home-assistant/core/releases?per_page=10 | 200 | readable (live collector run, 0 notices); github.com/home-assistant/core/releases 200 (558928 B) | 2026-09-23 |
| self-hosting | Immich releases | yes | https://api.github.com/repos/immich-app/immich/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| self-hosting | Jellyfin releases | yes | https://api.github.com/repos/jellyfin/jellyfin/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| networking | IETF datatracker new RFCs and drafts | yes | https://datatracker.ietf.org/ | 200 | readable (49628 B) | 2026-09-23 |
| networking | 3GPP, ITU announcements | yes | https://www.3gpp.org/news-events | 200 | readable (116272 B) | 2026-09-23 |
| networking | arXiv eess.SP listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:eess.SP | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| smart-home-iot | Connectivity Standards Alliance announcements | yes | https://csa-iot.org/newsroom/ | 200 | readable (203947 B) | 2026-09-23 |
| smart-home-iot | Zigbee, Z-Wave, LoRa alliance news | yes | https://lora-alliance.org/ | 200 | readable (the first URL tried, /newsroom/, is 404) | 2026-09-23 |
| smart-home-iot | Matter releases | yes | https://api.github.com/repos/project-chip/connectedhomeip/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| personal-computing | Framework, System76, Pine64 blogs | yes | https://frame.work/blog | 200 | readable (121816 B) | 2026-09-23 |
| personal-computing | Phoronix | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| personal-computing | Framework Embedded Controller releases | yes | https://api.github.com/repos/FrameworkComputer/EmbeddedController/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| security-privacy | GitHub Security Advisories, NVD | yes | https://services.nvd.nist.gov/rest/json/cves/2.0 | 200 | readable (NVD API: 263838 B, 75 advisories); github.com/advisories 200 (260712 B); NVD detail pages are 2092-byte client-rendered shells with no advisory text, so an NVD item is link-only | 2026-09-23 |
| security-privacy | Project security mailing lists | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| security-privacy | Google Project Zero blog | yes | https://googleprojectzero.blogspot.com/ | 200 | readable (44208 B) | 2026-09-23 |
| security-privacy | OpenSSL releases | yes | https://api.github.com/repos/openssl/openssl/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| security-privacy | curl releases | yes | https://api.github.com/repos/curl/curl/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| security-privacy | arXiv cs.CR listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.CR | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| security-privacy | The Register | yes | https://www.theregister.com/networks/2026/09/23/southern-water-taps-fiber-network-to-sniff-out-leaky-pipes/5298527 | 200 | readable (article page: 164062 B, 47 paragraphs); feed theregister.com/headlines.atom 200 (264145 B, 50 items) | 2026-09-23 |
| tech-policy | IETF, W3C, ISO news | yes | https://www.w3.org/news/ | 200 | readable at W3C; iso.org returned 403 | 2026-09-23 |
| tech-policy | EU Commission digital policy pages | yes | https://digital-strategy.ec.europa.eu/en | 200 | readable (53379 B) | 2026-09-23 |
| tech-policy | 中国工业和信息化部, 中国信息通信研究院 | yes | https://www.miit.gov.cn/ | 200 | readable (56162 B) | 2026-09-23 |
| energy-power | IEA, NREL publications | yes | https://www.iea.org/news | 200 | readable (342929 B) | 2026-09-23 |
| energy-power | Battery and solar vendor technical blogs | yes | -- | -- | not addressed: the row names no publication and no URL | 2026-09-23 |
| energy-power | arXiv, Joule research listings | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| materials-mfg | Nature Materials, Science coverage | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| materials-mfg | arXiv cond-mat.mtrl-sci listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cond-mat.mtrl-sci | 200 | readable | 2026-09-23 |
| built-environment | RMI, IEA buildings publications | yes | https://rmi.org/news/ | 200 | readable (386687 B) | 2026-09-23 |
| climate-earth | Copernicus, NOAA announcements | yes | https://www.copernicus.eu/en | 200 | readable at Copernicus; noaa.gov returned 403 | 2026-09-23 |
| climate-earth | ECMWF and AI weather model papers | yes | https://www.ecmwf.int/en/about/media-centre/news | 200 | readable (79746 B) | 2026-09-23 |
| ocean-water | NOAA, IOC publications | yes | https://ioc.unesco.org/ | 200 | readable at IOC; noaa.gov returned 403 | 2026-09-23 |
| power-electronics | IEEE Power Electronics Society news | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| power-electronics | GaN and SiC vendor technical notes | yes | -- | -- | not addressed: the row names no publication and no URL | 2026-09-23 |
| robotics | arXiv cs.RO listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.RO | 200 | readable | 2026-09-23 |
| robotics | ROS and vendor release notes | yes | https://www.ros.org/news/ | 200 | readable (51318 B) | 2026-09-23 |
| robotics | ROS 2 releases | yes | https://api.github.com/repos/ros2/ros2/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| industrial-ot | ISA, IEC 62443 updates | yes | https://www.isa.org/news | 200 | readable (330274 B) | 2026-09-23 |
| industrial-ot | CISA ICS advisories | yes | https://www.cisa.gov/news-events/cybersecurity-advisories | 200 | readable (163878 B) | 2026-09-23 |
| industrial-ot | Zephyr releases | yes | https://api.github.com/repos/zephyrproject-rtos/zephyr/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| transport | IEA Global EV Outlook, ICCT publications | yes | https://theicct.org/publications/ | 200 | readable (164410 B) | 2026-09-23 |
| transport | Automotive World, electrive | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| supply-chain | Drewry and port authority releases | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| supply-chain | DCSA, GS1 logistics standards releases | yes | https://dcsa.org/ | 200 | readable at DCSA; gs1.org returned 403 | 2026-09-23 |
| simulation-cae | Ansys, Dassault, Siemens release notes | yes | https://www.ansys.com/blog | 200 | readable (1048910 B) | 2026-09-23 |
| simulation-cae | FreeCAD releases | yes | https://api.github.com/repos/freecad/FreeCAD/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| simulation-cae | SWIG releases | yes | https://api.github.com/repos/swig/swig/releases?per_page=10 | 200 | readable (live collector run, 0 notices) | 2026-09-23 |
| biotech-health | Nature Biotechnology, NEJM coverage | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| biotech-health | FDA, EMA approval announcements | yes | https://www.fda.gov/news-events/newsroom/press-announcements | 200 | readable (the path first tried is 404) | 2026-09-23 |
| neuro-bci | Neuralink, Synchron, Blackrock Neurotech updates | yes | https://neuralink.com/blog/ | 200 | readable (279039 B) | 2026-09-23 |
| neuro-bci | arXiv q-bio.NC listing | feed-only | -- | -- | not addressed: no collector target for q-bio.NC | 2026-09-23 |
| wearables-sensors | FDA device clearances and vendor release notes | yes | https://www.fda.gov/medical-devices/products-and-medical-procedures/device-approvals-denials-and-clearances | 200 | readable (the path first tried is 404) | 2026-09-23 |
| frontier-science | arXiv astro-ph, hep-th and math listings | feed-only | https://export.arxiv.org/api/query?search_query=cat:astro-ph.IM | 200 | readable | 2026-09-23 |
| frontier-science | Nature, Science news | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| space-aerospace | NASA, ESA, SpaceX updates | yes | https://www.nasa.gov/news/ | 200 | readable (310224 B) | 2026-09-23 |
| space-aerospace | arXiv astro-ph.IM listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:astro-ph.IM | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| defence-dual-use | Janes, IISS analysis | no | https://www.janes.com/ | 200 | homepage readable; the analysis behind it is paywalled (126739 B) | 2026-09-23 |
| defence-dual-use | Government defence procurement announcements | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| fintech-rails | BIS and central bank publications | yes | https://www.bis.org/ | 200 | readable (the path first tried is 404) | 2026-09-23 |
| fintech-rails | Federal Reserve, ECB payment announcements | yes | https://www.federalreserve.gov/newsevents.htm | 200 | readable (93063 B) | 2026-09-23 |
| spatial-computing | Meta, Apple, Sony developer documentation updates | yes | https://developer.apple.com/news/ | 200 | readable (506799 B) | 2026-09-23 |
| spatial-computing | microLED and waveguide vendor technical notes | yes | -- | -- | not addressed: the row names no publication and no URL | 2026-09-23 |
| audio-speech | arXiv eess.AS and cs.SD listings | feed-only | https://export.arxiv.org/api/query?search_query=cat:eess.AS | 200 | readable | 2026-09-23 |
| audio-speech | IETF codec working group drafts | yes | https://datatracker.ietf.org/group/cellar/documents/ | 200 | readable (48242 B) | 2026-09-23 |
| audio-speech | arXiv eess.AS listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:eess.AS | 200 | readable (arXiv collector, 0 notices) | 2026-09-23 |
| hci-research | ACM CHI, UIST proceedings | feed-only | -- | -- | not addressed: no URL in the row and no collector target | 2026-09-23 |
| hci-research | arXiv cs.HC listing | feed-only | https://export.arxiv.org/api/query?search_query=cat:cs.HC | 200 | readable | 2026-09-23 |
| every | Hacker News, Lobsters, Reddit, X, Techmeme, Google News, Baidu News, V2EX, 掘金, 知乎, 少数派, Weibo | feed-only | -- | -- | not addressed: discovery surfaces are not cited; no single URL to probe | 2026-09-23 |
| every | GitHub releases | yes | https://api.github.com/repos/<watched repository>/releases?per_page=10 | 200 | readable (live collector run, 0 notices); this form names no single target, so every repository row above is its evidence | 2026-09-23 |

Totals: 178 registry rows — 137 `yes`, 39 `feed-only`, 2 `no`. Every `yes` row carries a dated probe
entry above, which `tests/feasibility.test.mjs` enforces; the `feed-only` and `no` rows are covered where a
collector target exists and recorded as not addressed where none does. The registry grew from 96 rows to 178 in
this pass, and the additions are listed under *Rows added for collector-driven outlets*.

## Readable

127 of the 133 probed `yes` rows returned readable content at HTTP 200. The content types match
the registry’s `kind` column: release pages and release APIs from GitHub, package-registry metadata, blog
indexes, news indexes, specifications, advisory APIs. Nothing in this group contradicts the registry. One
further probed `yes` row — `机器之心` — answered 200 with no readable content and was corrected; see below.

5 `yes` rows returned 200 for at least one named outlet but 403 for another, and are recorded as readable
with the block noted: `OpenAI, Anthropic, Google DeepMind, Meta AI release blogs` (openai.com 403,
anthropic.com/news 200), `IETF, W3C and ISO news` (iso.org 403, w3.org 200), `Copernicus and NOAA
announcements` and `NOAA and IOC publications` (noaa.gov 403, copernicus.eu and ioc.unesco.org 200), and
`DCSA and GS1 logistics standards releases` (gs1.org 403, dcsa.org 200). These rows keep `fetchable: yes`:
the row names several outlets and at least one of them is readable, so the registry’s claim is not
contradicted — the blocked member is recorded here instead.

## Feed-only rows with a collector target

The 39 `feed-only` rows are not fetched by the per-row probe; they are reached through
`config/watchlist.md`. 22 of them have a target that was exercised live on the probe date and answered 200:
every arXiv category the collector watches — now one registry row each (cs.AI, cs.CL, cs.LG, cs.CV, cs.DC,
cs.GR, cs.HC, cs.LO, cs.PL, cs.RO, cs.AR, cs.CR, eess.AS, eess.SP, quant-ph, cond-mat.mtrl-sci,
astro-ph.IM) — and LWN’s headline feed. The other 17 `feed-only` rows name outlets such as trade
press, conference proceedings or mailing lists that no collector target covers; they are recorded as
`not addressed` rather than guessed at.

## Rows added for collector-driven outlets

The three GREEN runs collected one gate warning per item for outlets the collector itself had produced,
because `config/sources.md` did not name them: `GitHub releases`, `Ultralytics releases`, `arXiv cs.AR
listing`, `arXiv cs.CL listing`, `arXiv eess.AS listing` and the `Rust blog`. Registering an outlet is a
config edit a run is not allowed to make, so the registry was completed here instead: 81 rows covering
the GitHub, arXiv, package-registry and feed targets `scripts/collect.mjs` actually fetches, each assigned
to the domain `config/watchlist.md` gives that target.

| class | rows | how they were chosen | tier, kind and why that is a legitimate primary |
|---|---|---|---|
| GitHub releases for a watched repository | 55 | one per `github-repo` target, named `<Project> releases` | `primary` `release`, or `spec` for the three standards repositories (tc39/proposals, whatwg/html, KhronosGroup/Vulkan-Docs) — a release page is the project announcing its own artifact, so it is the artifact’s own record rather than reporting about it |
| arXiv category listings | 10 | the watched categories with no matching row: cs.AI, cs.CL, cs.LG, cs.PL, cs.CR, cs.LO, cs.AR, eess.AS, eess.SP, astro-ph.IM | `primary` `paper`, `feed-only` — the listing is the preprint stream itself; the other seven watched categories already had an identically named row |
| package-registry releases | 12 | one per npm, PyPI, crates.io and Go modules target | `primary` `release` — the registry serves the maintainers’ own release metadata, so the package page is the artifact’s own record |
| feed-collector outlets | 3 | the RSS targets no row named: Rust blog, Node.js release blog, The Register | `primary` `blog` for the two project blogs and `secondary` `press` for The Register — a project blog is the project announcing its own work; a trade outlet reporting on someone else is secondary |
| the generic citation form | 1 | `GitHub releases`, domain `every` | `primary` `release` — the bare form names no target, so it belongs to no single domain; the 55 per-repository rows carry the per-domain assignment, and this row exists so a run that cites the platform rather than the project is not warned for normal collector output |

Every added row has an entry in the probe table above. The GitHub rows were proven by the fresh-budget full
collector run, whose zero notices is the collector’s only failure channel and therefore means all 55 release
requests answered 200; six of them were also read directly as HTML release pages, and those byte counts are
in the table. The arXiv and registry rows were proven per target by the recording-shim run, and the three
feed rows by reading each outlet’s feed and one of its article pages. The rows added in this pass are listed
above; no existing row’s value changed.

## Blocked

Four hosts refused automated fetch with HTTP 403 on the probe date, with both the default and the configured
user agent:

- `openai.com` — row `OpenAI, Anthropic, Google DeepMind, Meta AI release blogs`
- `iso.org` — row `IETF, W3C and ISO news`
- `noaa.gov` — rows `Copernicus and NOAA announcements` and `NOAA and IOC publications`
- `gs1.org` — row `DCSA and GS1 logistics standards releases`

The 403 bodies are bot-filter pages, not editorial pages. Per the rule above these are permission failures and
are not source defects. Each of the four rows names at least one other outlet that answered 200, so no
`fetchable` value was changed on their account; a run that needs the blocked member must cite the readable
one or drop the item.

## Rate-limited

The GitHub REST API is the one measured rate limit of this registry. Anonymous callers get 60 core requests
per hour from one address, measured directly: `GET https://api.github.com/rate_limit` reported
`used 60, remaining 0` during the first full run of 2026-09-23, and `used 0, remaining 60` immediately
before the second.

A full run is sized right at the edge of that budget: `config/watchlist.md` holds 55 `github-repo`
targets, and the collector issues one release request per target plus one request for
`GitHub Security Advisories` — 56 requests against the 58 spendable once the configured reserve of 2 is held
back, two requests of headroom. Both outcomes
were observed on the probe date:

- **From a partly spent budget the tail fails.** The first full run met an hour whose budget was already
  consumed. It printed `HTTP 403` notices carrying `API rate limit exceeded` for the trailing repositories
  and for the advisory request.
- **From a fresh budget the run completes.** The second full run started at `used 0, remaining 60`, exited 0
  with **0 notices**, and produced **841 candidates** across 22 domains.

A 403 of this shape is a rate limit, not a missing target and not a defect in the collector: the run degrades
to notices instead of throwing and still exits 0. The practical consequence is that a second full run inside
the same hour loses most of its GitHub sources, and the remedy is the optional `GITHUB_TOKEN` — the
operator's choice, not a change to the registry.

Two further facts, both verified on the probe date:

- The HTML pages the registry rows cite — `github.com/opencv/opencv/releases`,
  `github.com/YosysHQ/yosys/releases`, `github.com/numpy/numpy/releases`,
  `github.com/leanprover/lean4/releases`, `github.com/home-assistant/core/releases`,
  `github.com/ggml-org/llama.cpp/releases`, `github.com/tc39/proposals`,
  `github.com/advisories` — all answered 200 and are not subject to the API budget.
- NVD, the other advisory source in that row, answered 200 on both probes (75 advisories in the probe
  table's run, 80 in the earlier one) and has no equivalent anonymous limit at this volume. Which NVD
  surface is readable is set out under *NVD — which surface is readable*.

## Not addressed — could not verify

21 rows were assessed but not fetched, and this file claims nothing about their fetchability:

- Four `yes` rows name a class of source and no publication at all — `Co-packaged optics vendor blogs`,
  `Battery and solar vendor technical blogs`, `GaN and SiC vendor technical notes`,
  `microLED and waveguide vendor technical notes`. There is no page to probe, and inventing a vendor to probe
  would manufacture evidence. They keep `fetchable: yes` because nothing contradicts it; the entry here says
  the claim is untested.
- Seventeen `feed-only` rows name outlets that no collector target covers, such as `Taiwan and Korea trade
  press`, `Phoronix`, `Project security mailing lists` and `ACM CHI and UIST proceedings`. Their
  `feed-only` value says how they are reached — through a feed aggregator rather than by us — and this probe
  did not test that.

One further row is a judgement call worth naming: `Janes and IISS analysis` carries `fetchable: no` with the
note `paywalled; headline and link only`. The probe fetched `janes.com` (200) and got the headline layer;
the analysis behind it is what the paywall closes. The registry value is about the citable content, so it
stands, and the probe date is now in its note.

## Corrections applied to config/sources.md

| row | before | after | evidence |
|---|---|---|---|
| `机器之心` (ai-llm) | `fetchable: yes` | `fetchable: no`, probe date added to the note | the page renders its articles client-side; see below |
| `量子位` (ai-llm) | `fetchable: yes`, asserted on a homepage probe | value unchanged, note now records what is readable | article page and feed probed; see below |
| `GitHub Security Advisories and NVD` (security-privacy) | `yes`, note silent on which surface was read | value unchanged, note now names the readable surface and the link-only rule | NVD API and detail page probed; see below |
| `Janes and IISS analysis` (defence-dual-use) | `no`, note without a date | unchanged value, probe date added to the note | `docs/design.md` §3.2 requires the probe date in the note where `fetchable` is `no` |

One `fetchable` value changed in this pass - `机器之心`, from `yes` to `no`, on the evidence below - and every
other row keeps the value it already carried, with a corrected note. No row was weakened to make a source fit,
and no row was strengthened on the strength of a homepage alone. The only growth is the 81 rows added for collector-driven
outlets, listed above.

## 机器之心 — why the row changed

The registry claimed `fetchable: yes` with the note `Chinese AI reporting`. That claim is false, and it was
the only `yes` row this probe overturned.

- The probe of `https://www.jiqizhixin.com/` returned HTTP 200 and 12,601 bytes. The body is a
  client-rendered shell: 9 `<script>` tags, zero `<article>` elements, zero `<h2>` elements, 24 anchors and
  359 CJK characters, ending in an empty `<div class="home" id="home-index">` container. There is no article
  list in the response at all.
- Evidence gathered before this probe tested the rest of the site:
  `/feed`, `/rss`, `/articles` and article paths return either a landing page or a navigation shell with an
  empty article container, and `/sitemap.xml` is 404. No Wayback Machine snapshot exists.

So the site serves no machine-readable article content through any path tested, and the row's `yes` was
corrected to `no` with the probe date in the note. The row keeps `tier: secondary` and its `kind`: the outlet
remains a citable secondary source for a human reader, and an item may still cite one of its URLs; what is
withdrawn is the claim that automated fetch can read it.

## 量子位 — what the probe proved

The row’s `fetchable: yes` was first asserted on a homepage probe alone, which is a weaker basis than the
value claims. Probed surface by surface on 2026-09-23 through `fetchText` with the configured user agent:

- **Homepage** `https://www.qbitai.com/` — HTTP 200, 63,058 bytes. Zero `<article>` elements and zero
  `<h2>` elements. It carries article links with titles (`/2026/09/<id>.html`) but no article list a consumer
  can rely on, so the homepage alone does not make the outlet readable.
- **Feed** `https://www.qbitai.com/feed` — HTTP 200, 5,494 bytes, RSS 2.0 with 10 items and a resolvable
  first-item link.
- **Article page** `https://www.qbitai.com/2026/09/496609.html` — HTTP 200, 50,314 bytes, 20 `<p>`
  elements, 2,253 CJK characters with the article text served in the response.

The value therefore stays `yes`, but on the strength of an article page and a feed rather than a homepage:
what makes the outlet usable is exactly what the article probes show. An item attributed to it can carry a
date read from the article page, not merely from a headline on the index.

## NVD — which surface is readable

The `GitHub Security Advisories and NVD` row covers two advisory surfaces that behave differently, and its
note did not say which one the probe had read. Both were probed on 2026-09-23:

- **NVD API** `https://services.nvd.nist.gov/rest/json/cves/2.0` — HTTP 200, 263,838 bytes, 75 advisories in
  the seven-day window. This is the readable NVD surface, and it is what the collector reads.
- **NVD detail page** `https://nvd.nist.gov/vuln/detail/CVE-2026-71179` — HTTP 200 but only 2,092 bytes,
  three `<script>` tags, and the visible text is `NVD - Home`; the page does not contain the CVE identifier
  it is addressed by. It is a client-rendered shell.
- **GitHub advisories page** `https://github.com/advisories` — HTTP 200, 260,712 bytes. The advisory API
  behind it shares the anonymous GitHub rate budget recorded above.

Consequence: an item sourced from NVD is link-only — its citation URL is the detail page, whose text we
cannot read; the advisory content we report comes from the API. The registry value stays `yes` because
automated fetch does achieve the advisory content, and the note now says which surface is which.

## Live collector runs

Three runs on 2026-09-23, all against the shipped `config/`:

- **Full run, exhausted budget** — `node scripts/collect.mjs --config config --since <7 days> --out <pool>
  --human`, exit 0. It exercised every source kind at once: GitHub releases, arXiv, the
  npm/pypi/crates/gomod registries, GitHub advisories, NVD and the RSS feeds. Its notices were the GitHub
  rate-limit 403s recorded above. This run's candidate counts were not retained, so nothing here is claimed
  about them.
- **Full run, fresh budget** — the same command again once the anonymous budget had reset, starting from
  `used 0, remaining 60`: exit 0, **0 notices**, **841 candidates** across 22 domains (ai-llm 114,
  security-privacy 201, chips-hardware 55, hpc-scientific 41, space-aerospace 40, materials-mfg 38,
  quantum 37, computer-vision 36, power-electronics 36, audio-speech 35, formal-methods 35, hci-research 34,
  robotics 33, languages-runtimes 32, graphics-media 25, linux-os 16, self-hosting 13, data-storage 10,
  devtools 6, infra-cloud 2, simulation-cae 1, web-platform 1). This is the complete record of the
  second live run: with the budget free, every source kind answers.
- **The feed, registry and arXiv path** — run with a recording shim around `fetchText` so every request's
  outcome was captured individually. All 7 RSS targets, all 12 registry targets and all 16 arXiv queries
  answered 200 (feeds 96 candidates, registries 2 inside the window, arXiv 651), with zero notices. Byte
  counts per target are the reason the feed and registry rows above read `readable`.

## Re-probing

This file is dated, not permanent. `docs/design.md` §8.6 accepts that fetchability ages and directs a
re-probe once a source fails twice; when that happens, add a row here rather than overwriting this pass, and
change `config/sources.md` only where the new evidence contradicts it. A new row belongs in the probe table
above — the first table in this file — because that is the table `tests/feasibility.test.mjs` reads, and it
must carry that pass's own probe date. The guard covers the mechanical part: every row the registry marks
`fetchable: yes` must have a probe entry here carrying a `YYYY-MM-DD` probe date.
