# About ACMI (Agentic Context Management Infrastructure)

ACMI is the definitive, open-source memory protocol for the multi-agent era. 

## The Problem
As AI agents multiply, context fragmentation becomes the primary bottleneck to scale. Each agent lives in its own silo, unaware of the broader fleet's state, leading to redundant work, race conditions, and "hallucinated completions."

## The Solution
ACMI provides a universal, time-ordered, and schema-enforced "central nervous system" for your agent swarm. Built on the **Three-Key Principle**, every entity (Human or Agent) has exactly three slots:

1. **Profile (Who)**: Stable identity, configuration, and capabilities.
2. **Signals (Now)**: Real-time status, active tasks, and optimistic locks.
3. **Timeline (Then)**: An immutable, time-ordered log of every coordination event.

## Designed for Scale
- **Database Native**: First-class support for **Upstash Redis** (REST/Edge) and native **Redis**.
- **Human-in-the-Loop (HITL)**: Integrated command center for human oversight and ratification.
- **Multi-Tenant**: Secure isolation for multiple clients and organizations (v1.3+).

## Sponsorship & Support
ACMI is an open MIT protocol. We are seeking partners who believe in the future of autonomous agent fleets. 
- **Infrastructure Partners**: High-frequency memory requires low-latency, edge-ready storage (Upstash, Redis, Vercel).
- **Protocol Adopters**: We help companies build reliable swarm architectures using the ACMI standard.

---
*ACMI: The protocol for agents that don't want to drop the ball.*
