---
title: 'So what is Layerwise Relevance Propagation?'
date: 2025-07-07
tags: ['Machine Learning', 'Interpretability', 'Computer Science']
summary: 'A primer on LRP — how we attribute a network’s prediction back to its input neurons by treating nonlinearities as first-order Taylor expansions. An evolving note.'
scene: 'network'
---

Say we have a simple neural network. How do we know which input neurons mattered most for
the final prediction?

One family of answers is *perturbation*: poke each input, see how much the output moves.
That works, but it's expensive and a little blunt. Layerwise Relevance Propagation (LRP)
takes a different route.

## The core idea

A neural network is, generally speaking, a stack of nonlinear functions. The trick behind
LRP is to **approximate each of those nonlinear functions as a first-order Taylor
expansion** — a local linearization — and then use that linear structure to push
"relevance" backward, layer by layer, from the output down to the inputs. Each neuron
hands its relevance to the neurons that fed it, in proportion to how much each one
actually contributed.

Run that all the way to the input layer and you get a relevance score per input neuron: a
map of what the network leaned on.

## Conservation and positivity

LRP comes with some nice properties. There's a **conservation** property — relevance is
neither created nor destroyed as it flows down through the layers — and a **positivity**
flavor in the classic rules. Both are satisfying, and they make the attributions easier to
trust.

It's worth noting, though, that these constraints are **not strictly required**, and a lot
of more recent work relaxes or ignores them in pursuit of sharper attributions.

## Where it's going

The interesting frontier is attention. **AttnLRP** extends these ideas to transformer
attention, and the line of work around **Chefer et al.** shows how to get clean relevance
maps through attention layers specifically. That's where I want to take this note next —
into how relevance propagates through attention, and what it tells us about what these
models are really doing.

*This is an evolving note; I'll expand the derivation and the attention case over time.*
