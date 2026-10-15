# Source registry

`tier` is the evidence class of the *page cited*, not of the organisation. `fetchable` is what automated
fetch actually achieved, proven by the dated probe recorded in `reference/feasibility.md`.

| domain | source | tier | kind | lang | fetchable | note |
|---|---|---|---|---|---|---|
| ai-llm | arXiv cs.CL and cs.AI listings | primary | paper | en | feed-only | collected through the arXiv collector |
| ai-llm | Hugging Face blog | primary | blog | en | yes | model and library releases |
| ai-llm | OpenAI, Anthropic, Google DeepMind, Meta AI release blogs | primary | release | en | yes | official capability announcements |
| ai-llm | DeepSeek | primary | release | en | yes | the named release page serves English; probe 2026-09-23: api-docs.deepseek.com/news is Latin-only (4 CJK characters in 45 kB) |
| ai-llm | Qwen release blogs | primary | release | en | yes | the named release blog serves English; probe 2026-09-23: qwenlm.github.io/blog is Latin-only |
| ai-llm | 机器之心 | secondary | press | zh | no | Chinese AI reporting; probe 2026-09-23: client-rendered, no article content is fetchable |
| ai-llm | 量子位 | secondary | press | zh | yes | Chinese AI reporting; article pages readable, homepage is a title-link index (probe 2026-09-23) |
| ai-llm | vLLM releases | primary | release | en | yes | GitHub releases for the watched repository vllm-project/vllm |
| ai-llm | Transformers releases | primary | release | en | yes | GitHub releases for the watched repository huggingface/transformers |
| ai-llm | PyTorch releases | primary | release | en | yes | GitHub releases for the watched repository pytorch/pytorch |
| ai-llm | DeepSeek releases | primary | release | en | yes | GitHub releases for the watched repository deepseek-ai/DeepSeek-V3 |
| ai-llm | Qwen releases | primary | release | en | yes | GitHub releases for the watched repository QwenLM/Qwen3 |
| ai-llm | OpenAI Python releases | primary | release | en | yes | GitHub releases for the watched repository openai/openai-python |
| ai-llm | Model Context Protocol releases | primary | release | en | yes | GitHub releases for the watched repository modelcontextprotocol/servers |
| ai-llm | arXiv cs.AI listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.AI |
| ai-llm | arXiv cs.CL listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.CL |
| ai-llm | arXiv cs.LG listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.LG |
| ai-llm | PyPI torch | primary | release | en | yes | collector-driven package release; target torch |
| ai-llm | PyPI transformers | primary | release | en | yes | collector-driven package release; target transformers |
| chips-hardware | NVIDIA newsroom and developer blog | primary | blog | en | yes | roadmap and product releases |
| chips-hardware | AMD, Intel newsrooms | primary | blog | en | yes | CPU and accelerator releases |
| chips-hardware | IEEE Spectrum semiconductors | secondary | press | en | yes | independent analysis |
| chips-hardware | Taiwan and Korea trade press | secondary | press | en | feed-only | supply-chain reporting |
| chips-hardware | NVIDIA CUDA samples releases | primary | release | en | yes | GitHub releases for the watched repository NVIDIA/cuda-samples |
| chips-hardware | arXiv cs.AR listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.AR |
| computer-vision | arXiv cs.CV listing | primary | paper | en | feed-only | the field's primary venue stream |
| computer-vision | CVPR, ICCV, ECCV proceedings pages | primary | paper | en | yes | conference results |
| computer-vision | OpenCV, ONNX Runtime release notes | primary | release | en | yes | deployment tooling |
| computer-vision | OpenCV releases | primary | release | en | yes | GitHub releases for the watched repository opencv/opencv |
| computer-vision | Ultralytics releases | primary | release | en | yes | GitHub releases for the watched repository ultralytics/ultralytics |
| computer-vision | COLMAP releases | primary | release | en | yes | GitHub releases for the watched repository colmap/colmap |
| photonics | Nature Photonics, Optica news | secondary | press | en | feed-only | research highlights |
| photonics | Co-packaged optics vendor blogs | primary | blog | en | yes | vendor-claim tagging applies |
| quantum | arXiv quant-ph listing | primary | paper | en | feed-only | preprints, tagged unreviewed |
| quantum | Nature, Science quantum coverage | secondary | press | en | feed-only | peer-reviewed results only |
| quantum | IBM, Google Quantum AI, IonQ blogs | primary | blog | en | yes | hardware claims, vendor-claim tagging applies |
| eda-silicon | Yosys, OpenROAD, RISC-V project releases | primary | release | en | yes | open silicon tooling |
| eda-silicon | SemiEngineering | secondary | press | en | yes | design-flow reporting |
| eda-silicon | Yosys releases | primary | release | en | yes | GitHub releases for the watched repository YosysHQ/yosys |
| eda-silicon | OpenROAD releases | primary | release | en | yes | GitHub releases for the watched repository The-OpenROAD-Project/OpenROAD |
| eda-silicon | RISC-V ISA simulator releases | primary | release | en | yes | GitHub releases for the watched repository riscv-software-src/riscv-isa-sim |
| hpc-scientific | arXiv cs.DC listing | primary | paper | en | feed-only | distributed and HPC research |
| hpc-scientific | TOP500 and exascale centre announcements | primary | release | en | yes | system milestones |
| hpc-scientific | NumPy, SciPy, JAX release notes | primary | release | en | yes | numerical stack |
| hpc-scientific | NumPy releases | primary | release | en | yes | GitHub releases for the watched repository numpy/numpy |
| hpc-scientific | JAX releases | primary | release | en | yes | GitHub releases for the watched repository google/jax |
| hpc-scientific | XLA releases | primary | release | en | yes | GitHub releases for the watched repository openxla/xla |
| languages-runtimes | Node, Python, Rust, Go, TypeScript release notes | primary | release | en | yes | via the GitHub collector and project feeds |
| languages-runtimes | TC39, PEP, Rust RFC indexes | primary | spec | en | yes | language proposals |
| languages-runtimes | Node.js releases | primary | release | en | yes | GitHub releases for the watched repository nodejs/node |
| languages-runtimes | CPython releases | primary | release | en | yes | GitHub releases for the watched repository python/cpython |
| languages-runtimes | Rust releases | primary | release | en | yes | GitHub releases for the watched repository rust-lang/rust |
| languages-runtimes | Go releases | primary | release | en | yes | GitHub releases for the watched repository golang/go |
| languages-runtimes | TypeScript releases | primary | release | en | yes | GitHub releases for the watched repository microsoft/TypeScript |
| languages-runtimes | Deno releases | primary | release | en | yes | GitHub releases for the watched repository denoland/deno |
| languages-runtimes | Bun releases | primary | release | en | yes | GitHub releases for the watched repository oven-sh/bun |
| languages-runtimes | arXiv cs.PL listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.PL |
| languages-runtimes | npm typescript | primary | release | en | yes | collector-driven package release; target typescript |
| languages-runtimes | crates.io tokio | primary | release | en | yes | collector-driven package release; target tokio |
| languages-runtimes | crates.io serde | primary | release | en | yes | collector-driven package release; target serde |
| languages-runtimes | Rust blog | primary | blog | en | yes | the Rust project's own blog; collector target blog.rust-lang.org/feed.xml |
| languages-runtimes | Node.js release blog | primary | blog | en | yes | the Node.js project's own release blog; collector target nodejs.org/en/feed/blog.xml |
| devtools | VS Code, Neovim, Zed release notes | primary | release | en | yes | editor releases |
| devtools | LSP, Tree-sitter specifications | primary | spec | en | yes | protocol changes |
| devtools | VS Code releases | primary | release | en | yes | GitHub releases for the watched repository microsoft/vscode |
| devtools | Neovim releases | primary | release | en | yes | GitHub releases for the watched repository neovim/neovim |
| devtools | Zed releases | primary | release | en | yes | GitHub releases for the watched repository zed-industries/zed |
| devtools | Tree-sitter releases | primary | release | en | yes | GitHub releases for the watched repository tree-sitter/tree-sitter |
| devtools | npm vite | primary | release | en | yes | collector-driven package release; target vite |
| devtools | PyPI pydantic | primary | release | en | yes | collector-driven package release; target pydantic |
| web-platform | Chrome, Firefox, Safari release notes | primary | release | en | yes | browser features |
| web-platform | W3C news, WHATWG commits | primary | spec | en | yes | standards activity |
| web-platform | TC39 proposals releases | primary | spec | en | yes | GitHub releases for the watched repository tc39/proposals |
| web-platform | WHATWG HTML releases | primary | spec | en | yes | GitHub releases for the watched repository whatwg/html |
| web-platform | npm react | primary | release | en | yes | collector-driven package release; target react |
| oss-governance | Software Freedom Conservancy, OSI announcements | primary | blog | en | yes | governance and licensing |
| oss-governance | OpenSSF blog | primary | blog | en | yes | critical-project sustainability |
| graphics-media | Khronos, Vulkan release notes | primary | spec | en | yes | graphics APIs |
| graphics-media | Blender, Godot, Unreal release notes | primary | release | en | yes | engine and tooling releases |
| graphics-media | arXiv cs.GR listing | primary | paper | en | feed-only | graphics research |
| graphics-media | Godot releases | primary | release | en | yes | GitHub releases for the watched repository godotengine/godot |
| graphics-media | Vulkan releases | primary | spec | en | yes | GitHub releases for the watched repository KhronosGroup/Vulkan-Docs |
| formal-methods | Lean, Coq, Isabelle release notes | primary | release | en | yes | proof assistants |
| formal-methods | arXiv cs.LO and cs.SE listings | primary | paper | en | feed-only | verification research |
| formal-methods | Lean releases | primary | release | en | yes | GitHub releases for the watched repository leanprover/lean4 |
| formal-methods | arXiv cs.LO listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.LO |
| linux-os | LWN kernel coverage | secondary | press | en | feed-only | kernel development reporting |
| linux-os | kernel.org releases, systemd releases | primary | release | en | yes | upstream releases |
| linux-os | Distro release announcements | primary | release | en | feed-only | Fedora, Debian, Ubuntu, Arch |
| linux-os | Linux kernel releases | primary | release | en | yes | GitHub releases for the watched repository torvalds/linux |
| linux-os | systemd releases | primary | release | en | yes | GitHub releases for the watched repository systemd/systemd |
| infra-cloud | CNCF, Kubernetes release notes | primary | release | en | yes | orchestration releases |
| infra-cloud | AWS, Google Cloud, Azure changelogs | primary | release | en | yes | cloud platform changes |
| infra-cloud | Kubernetes releases | primary | release | en | yes | GitHub releases for the watched repository kubernetes/kubernetes |
| infra-cloud | containerd releases | primary | release | en | yes | GitHub releases for the watched repository containerd/containerd |
| infra-cloud | Moby releases | primary | release | en | yes | GitHub releases for the watched repository moby/moby |
| infra-cloud | PyPI fastapi | primary | release | en | yes | collector-driven package release; target fastapi |
| infra-cloud | crates.io axum | primary | release | en | yes | collector-driven package release; target axum |
| infra-cloud | Go modules k8s.io/client-go | primary | release | en | yes | collector-driven package release; target k8s.io/client-go |
| infra-cloud | Go modules github.com/prometheus/client_golang | primary | release | en | yes | collector-driven package release; target github.com/prometheus/client_golang |
| data-storage | PostgreSQL, DuckDB, ClickHouse release notes | primary | release | en | yes | database engines |
| data-storage | Apache Iceberg and Arrow release notes | primary | release | en | yes | table formats and columnar tooling |
| data-storage | DuckDB releases | primary | release | en | yes | GitHub releases for the watched repository duckdb/duckdb |
| data-storage | ClickHouse releases | primary | release | en | yes | GitHub releases for the watched repository ClickHouse/ClickHouse |
| data-storage | Apache Iceberg releases | primary | release | en | yes | GitHub releases for the watched repository apache/iceberg |
| data-storage | Apache Arrow releases | primary | release | en | yes | GitHub releases for the watched repository apache/arrow |
| self-hosting | Home Assistant, Immich, Jellyfin releases | primary | release | en | yes | self-hosted services |
| self-hosting | llama.cpp, Ollama releases | primary | release | en | yes | local inference |
| self-hosting | llama.cpp releases | primary | release | en | yes | GitHub releases for the watched repository ggml-org/llama.cpp |
| self-hosting | Ollama releases | primary | release | en | yes | GitHub releases for the watched repository ollama/ollama |
| self-hosting | Home Assistant releases | primary | release | en | yes | GitHub releases for the watched repository home-assistant/core |
| self-hosting | Immich releases | primary | release | en | yes | GitHub releases for the watched repository immich-app/immich |
| self-hosting | Jellyfin releases | primary | release | en | yes | GitHub releases for the watched repository jellyfin/jellyfin |
| networking | IETF datatracker new RFCs and drafts | primary | spec | en | yes | protocol standards |
| networking | 3GPP, ITU announcements | primary | spec | en | yes | cellular standards |
| networking | arXiv eess.SP listing | primary | paper | en | feed-only | collected through the arXiv collector as eess.SP |
| smart-home-iot | Connectivity Standards Alliance announcements | primary | spec | en | yes | Matter and Thread |
| smart-home-iot | Zigbee, Z-Wave, LoRa alliance news | primary | spec | en | yes | protocol ecosystems |
| smart-home-iot | Matter releases | primary | release | en | yes | GitHub releases for the watched repository project-chip/connectedhomeip |
| personal-computing | Framework, System76, Pine64 blogs | primary | blog | en | yes | repairable client hardware |
| personal-computing | Phoronix | secondary | press | en | feed-only | Linux hardware enablement |
| personal-computing | Framework Embedded Controller releases | primary | release | en | yes | GitHub releases for the watched repository FrameworkComputer/EmbeddedController |
| security-privacy | GitHub Security Advisories, NVD | primary | advisory | en | yes | collected through the advisory collector; probe 2026-09-23: the NVD API is readable, NVD detail pages are shells, so an NVD item is link-only |
| security-privacy | Project security mailing lists | primary | advisory | en | feed-only | OpenSSL, curl, glibc |
| security-privacy | Google Project Zero blog | primary | blog | en | yes | vulnerability research |
| security-privacy | OpenSSL releases | primary | release | en | yes | GitHub releases for the watched repository openssl/openssl |
| security-privacy | curl releases | primary | release | en | yes | GitHub releases for the watched repository curl/curl |
| security-privacy | arXiv cs.CR listing | primary | paper | en | feed-only | collected through the arXiv collector as cs.CR |
| security-privacy | The Register | secondary | press | en | yes | independent security and infrastructure reporting; collector target theregister.com/headlines.atom |
| tech-policy | IETF, W3C, ISO news | primary | spec | en | yes | standards process |
| tech-policy | EU Commission digital policy pages | primary | spec | en | yes | AI Act and DMA text |
| tech-policy | 中国工业和信息化部, 中国信息通信研究院 | primary | spec | zh | yes | Chinese policy and research primaries |
| energy-power | IEA, NREL publications | primary | paper | en | yes | energy system data |
| energy-power | Battery and solar vendor technical blogs | primary | blog | en | yes | vendor-claim tagging applies |
| energy-power | arXiv, Joule research listings | primary | paper | en | feed-only | peer-reviewed results |
| materials-mfg | Nature Materials, Science coverage | secondary | press | en | feed-only | peer-reviewed results |
| materials-mfg | arXiv cond-mat.mtrl-sci listing | primary | paper | en | feed-only | preprints, tagged unreviewed |
| built-environment | RMI, IEA buildings publications | primary | paper | en | yes | building decarbonisation |
| climate-earth | Copernicus, NOAA announcements | primary | release | en | yes | earth observation |
| climate-earth | ECMWF and AI weather model papers | primary | paper | en | yes | forecast models |
| ocean-water | NOAA, IOC publications | primary | paper | en | yes | ocean and water systems |
| power-electronics | IEEE Power Electronics Society news | secondary | press | en | feed-only | device and converter research |
| power-electronics | GaN and SiC vendor technical notes | primary | blog | en | yes | vendor-claim tagging applies |
| robotics | arXiv cs.RO listing | primary | paper | en | feed-only | robotics research |
| robotics | ROS and vendor release notes | primary | release | en | yes | tooling releases |
| robotics | ROS 2 releases | primary | release | en | yes | GitHub releases for the watched repository ros2/ros2 |
| industrial-ot | ISA, IEC 62443 updates | primary | spec | en | yes | safety and security standards |
| industrial-ot | CISA ICS advisories | primary | advisory | en | yes | OT vulnerabilities |
| industrial-ot | Zephyr releases | primary | release | en | yes | GitHub releases for the watched repository zephyrproject-rtos/zephyr |
| transport | IEA Global EV Outlook, ICCT publications | primary | paper | en | yes | transport data |
| transport | Automotive World, electrive | secondary | press | en | feed-only | industry reporting |
| supply-chain | Drewry and port authority releases | secondary | press | en | feed-only | logistics indicators |
| supply-chain | DCSA, GS1 logistics standards releases | primary | spec | en | yes | container shipping data and traceability standards |
| simulation-cae | Ansys, Dassault, Siemens release notes | primary | release | en | yes | CAE tooling |
| simulation-cae | FreeCAD releases | primary | release | en | yes | GitHub releases for the watched repository freecad/FreeCAD |
| simulation-cae | SWIG releases | primary | release | en | yes | GitHub releases for the watched repository swig/swig |
| biotech-health | Nature Biotechnology, NEJM coverage | secondary | press | en | feed-only | peer-reviewed results |
| biotech-health | FDA, EMA approval announcements | primary | release | en | yes | regulatory decisions |
| neuro-bci | Neuralink, Synchron, Blackrock Neurotech updates | primary | blog | en | yes | vendor-claim tagging applies |
| neuro-bci | arXiv q-bio.NC listing | primary | paper | en | feed-only | neuroscience preprints |
| wearables-sensors | FDA device clearances and vendor release notes | primary | release | en | yes | sensors and monitoring |
| frontier-science | arXiv astro-ph, hep-th and math listings | primary | paper | en | feed-only | preprints, tagged unreviewed |
| frontier-science | Nature, Science news | secondary | press | en | feed-only | peer-reviewed highlights |
| space-aerospace | NASA, ESA, SpaceX updates | primary | release | en | yes | mission milestones |
| space-aerospace | arXiv astro-ph.IM listing | primary | paper | en | feed-only | collected through the arXiv collector as astro-ph.IM |
| defence-dual-use | Janes, IISS analysis | secondary | press | en | no | paywalled; headline and link only; probe 2026-09-23 |
| defence-dual-use | Government defence procurement announcements | primary | release | en | feed-only | programme milestones |
| fintech-rails | BIS and central bank publications | primary | paper | en | yes | payment infrastructure |
| fintech-rails | Federal Reserve, ECB payment announcements | primary | release | en | yes | rails and standards |
| spatial-computing | Meta, Apple, Sony developer documentation updates | primary | spec | en | yes | platform capabilities |
| spatial-computing | microLED and waveguide vendor technical notes | primary | blog | en | yes | display engineering |
| audio-speech | arXiv eess.AS and cs.SD listings | primary | paper | en | feed-only | speech and audio research |
| audio-speech | IETF codec working group drafts | primary | spec | en | yes | codec standards |
| audio-speech | arXiv eess.AS listing | primary | paper | en | feed-only | collected through the arXiv collector as eess.AS |
| hci-research | ACM CHI, UIST proceedings | primary | paper | en | feed-only | interaction research |
| hci-research | arXiv cs.HC listing | primary | paper | en | feed-only | HCI preprints |
| every | Hacker News, Lobsters, Reddit, X, Techmeme, Google News, Baidu News, V2EX, 掘金, 知乎, 少数派, Weibo | discovery | feed | en | feed-only | never citable as a source; the gate blocks these hosts; Chinese-language surfaces: Baidu News, V2EX, 掘金, 知乎, 少数派, Weibo |
| every | GitHub releases | primary | release | en | yes | the generic citation form for a watched repository release; the per-repository rows above name each target |
