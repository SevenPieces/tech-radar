# Domain catalogue

The catalogue is configuration. `short` is the topic-navigation chip label the rendered HTML uses, so it must
stay a couple of words; `tier` is `core` (a section every week) or `watch` (reported only on a notable week).
`domain` and `label_zh` are the bilingual heading a section carries. Adding, removing or re-tiering a domain is a
one-line edit to this table.

| key | domain | short | label_zh | cluster | tier | why |
|---|---|---|---|---|---|---|
| ai-llm | AI / LLM | AI / LLM | 人工智能 / 大模型 | AI and compute | core | Models, agent frameworks, inference and serving, evals, agent protocols |
| chips-hardware | Chips, hardware and accelerators | Chips | 芯片、硬件与加速器 | AI and compute | core | GPUs, accelerators, CPUs, memory and storage, packaging and supply |
| computer-vision | Computer vision and perception | Vision | 计算机视觉与感知 | AI and compute | core | Detection, segmentation, 3D reconstruction, pose and depth, SLAM, video understanding |
| photonics | Photonics and optical interconnects | Photonics | 光子学与光互连 | AI and compute | watch | Silicon photonics, co-packaged optics, LiDAR, lasers |
| quantum | Quantum technologies | Quantum | 量子技术 | AI and compute | watch | Computing, sensing, communication, error correction |
| eda-silicon | EDA and open silicon | EDA / silicon | EDA 与开源芯片 | AI and compute | watch | Chip design tooling, RTL and verification flows, RISC-V ecosystems |
| hpc-scientific | Scientific computing and HPC | HPC | 科学计算与高性能计算 | AI and compute | watch | Numerical libraries, exascale systems, GPU programming models |
| languages-runtimes | Languages and runtimes | Languages | 编程语言与运行时 | Software craft | watch | Language releases, compilers, type systems, runtime and GC changes |
| devtools | Developer tools and editors | Dev tools | 开发工具与编辑器 | Software craft | watch | Editors, LSP, build systems, package managers, test and lint tooling |
| web-platform | Web platform and browsers | Web platform | Web 平台与浏览器 | Software craft | watch | Browser features, WebAssembly, web standards, CSS and JS platform changes |
| oss-governance | Open source governance and licensing | OSS governance | 开源治理与许可 | Software craft | watch | Licence changes, foundation moves, maintainer sustainability, critical-project risk |
| graphics-media | Real-time graphics, engines and generative media | Graphics | 实时图形、引擎与生成式媒体 | Software craft | core | Neural rendering, engines, codecs, digital humans, generative media pipelines |
| formal-methods | Formal methods and program verification | Formal methods | 形式化方法与程序验证 | Software craft | watch | Proof assistants, model checking, verified systems, safety cases |
| linux-os | Linux and operating systems | Linux / OS | Linux 与操作系统 | Systems and infrastructure | watch | Kernel, distros, systemd, container runtimes, filesystems |
| infra-cloud | Infrastructure, cloud and orchestration | Infra / cloud | 基础设施、云与编排 | Systems and infrastructure | watch | Kubernetes, infrastructure-as-code, serverless, observability |
| data-storage | Data, databases and storage | Data / storage | 数据、数据库与存储 | Systems and infrastructure | watch | OLTP and OLAP engines, vector databases, streaming, table formats |
| self-hosting | Self-hosting, local-first and privacy tech | Self-hosting | 自托管、本地优先与隐私技术 | Systems and infrastructure | core | Homelab and NAS, local inference, self-hosted services, privacy tooling |
| networking | Networking and telecom | Networking | 网络与电信 | Systems and infrastructure | watch | 5G-Advanced and 6G, satellite internet, undersea cables, protocols |
| smart-home-iot | Smart home and IoT protocols | Smart home | 智能家居与 IoT 协议 | Systems and infrastructure | watch | Matter, Thread, Zigbee, LoRa, local control and interoperability |
| personal-computing | Personal computing and devices | Personal computing | 个人计算与设备 | Systems and infrastructure | watch | Laptops, phones and SoCs, RISC-V client hardware, e-ink, repairability |
| security-privacy | Security and privacy | Security | 安全与隐私 | Security and trust | watch | CVEs that matter, cryptography, supply chain, sandboxing, auth standards |
| tech-policy | Tech policy, standards and regulation | Tech policy | 技术政策、标准与监管 | Security and trust | watch | IETF, W3C and ISO activity, EU AI Act and DMA, export controls |
| energy-power | Energy and power | Energy | 能源与电力 | Energy and the physical world | core | Batteries, solar and wind, grid storage, nuclear and SMRs, fusion |
| materials-mfg | Materials and advanced manufacturing | Materials | 材料与先进制造 | Energy and the physical world | core | Additive manufacturing, composites, critical minerals, superconductors |
| built-environment | Built environment and construction technology | Built environment | 建筑环境与建造技术 | Energy and the physical world | watch | Low-carbon concrete and steel, 3D-printed structures, building systems |
| climate-earth | Climate and earth observation | Climate / earth | 气候与对地观测 | Energy and the physical world | watch | Climate and weather modelling, carbon removal, earth observation |
| ocean-water | Ocean, water and critical resources | Ocean / water | 海洋、水与关键资源 | Energy and the physical world | watch | Desalination, undersea infrastructure, deep-sea mining, rare gases |
| power-electronics | Power electronics | Power electronics | 电力电子 | Energy and the physical world | watch | GaN and SiC devices, inverters, motor drives, grid-tie converters |
| robotics | Robotics and autonomy | Robotics | 机器人与自主系统 | Machines and industry | core | Humanoids, industrial and warehouse robotics, drones, embodied AI |
| industrial-ot | Industrial automation and OT | Industrial OT | 工业自动化与运营技术 | Machines and industry | core | PLCs and control systems, industrial protocols, functional safety, OT security |
| transport | Transport and mobility | Transport | 交通与出行 | Machines and industry | core | EVs and charging, grid interaction, aviation fuels, rail and shipping |
| supply-chain | Supply chains and logistics technology | Supply chain | 供应链与物流技术 | Machines and industry | watch | Port and warehouse automation, freight electrification, traceability |
| simulation-cae | Simulation and computer-aided engineering | Simulation | 仿真与计算机辅助工程 | Machines and industry | watch | FEA, CFD, multiphysics, digital twins, engineering simulation tooling |
| biotech-health | Biotech and health | Biotech / health | 生物技术与健康 | Life and health | watch | Gene editing and cell therapies, mRNA platforms, AI drug discovery |
| neuro-bci | Neuroscience and brain-computer interfaces | Neuro / BCI | 神经科学与脑机接口 | Life and health | core | Invasive and non-invasive BCIs, neural decoding, neurostimulation |
| wearables-sensors | Wearables, sensors and human augmentation | Wearables | 可穿戴、传感器与人体增强 | Life and health | core | Continuous monitoring, implantables, novel biosensors |
| frontier-science | Frontier science and fundamental research | Frontier science | 前沿科学与基础研究 | Frontier and society | watch | Physics results, astronomy and exoplanets, notable mathematics |
| space-aerospace | Space and aerospace | Space | 航天与航空 | Frontier and society | watch | Launch cadence and reusability, constellations, in-orbit servicing |
| defence-dual-use | Defence and dual-use technology | Defence | 国防与两用技术 | Frontier and society | core | Drones and counter-drone, electronic warfare, hypersonics, sensing |
| fintech-rails | Fintech and payment rails | Fintech | 金融科技与支付通道 | Frontier and society | watch | Instant payments, stablecoin and CBDC infrastructure, card networks |
| spatial-computing | Spatial computing, AR/VR and displays | Spatial computing | 空间计算、AR/VR 与显示 | Frontier and society | watch | Headsets and waveguides, micro-OLED and microLED, passthrough and input |
| audio-speech | Audio, speech and music technology | Audio / speech | 音频、语音与音乐技术 | Frontier and society | core | Real-time voice, speech recognition and synthesis, music generation |
| hci-research | HCI and interaction research | HCI | 人机交互研究 | Frontier and society | watch | Interaction techniques, input devices, accessibility, human factors |