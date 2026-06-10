---
title: 'To Be or not to be Bayesian'
date: 2025-07-07
tags: ['Machine Learning', 'Reasoning', 'Thinking']
summary: 'Bayesian updating is a great story for how beliefs change — but humans also reason their way to new beliefs. What if we treated reasoning as synthetic data generation?'
scene: 'network'
---

Many people have said that Bayesian updating is a good framework for understanding how
beliefs change over time. And it is. But humans can also significantly update their
beliefs by reaching a set of logical conclusions — reasoning itself is a major driver of
belief change.

I think this is a big reason humans can reach such high reasoning capabilities with so
little data: **we reason as a form of synthetic data generation.** We use a small amount
of data to build a fundamental set of axioms. Then, by applying logical reasoning to
those axioms, we generate a vastly larger and better space of inferences than the data
alone could justify.

There's enormous value in boiling knowledge down into more fundamental principles. This
is, famously, how Elon Musk describes reasoning: rather than taking textbook knowledge as
truth, he reduces it to something like Newton's laws, or the Lagrangian and Hamiltonian
formalisms. Then you return to the advanced, textbook-level knowledge *with* that
axiomatic footing — and now you have a solid base from which to absorb genuinely new
ideas.

## The huge idea

What if an LLM continually boiled its entire corpus of generated knowledge down into a
vector database of **axiomatic truths**, **likely truths**, and **false** statements —
and then somehow folded that structure back into the model itself?

We essentially want to build *circuits* in a neural network grounded in truths — a
subgraph of truths the rest of the model can lean on. A "truth-sensing detector," built
in.

What I find very interesting is that I arrived at this conclusion without seeing it as a
direct consequence of my initial Bayesian thinking — which, in a way, proves the point. A
single talk by François Chollet fundamentally updated my beliefs. That's not gradual
Bayesian updating on a stream of evidence; that's reasoning restructuring the prior.
