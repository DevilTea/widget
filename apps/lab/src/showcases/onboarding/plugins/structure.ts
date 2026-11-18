/**
 * The structure validators the onboarding plugins share. Only a structure validator receives the Blueprint, so
 * the rules that look at another widget live here; each is an `invalid-widget-structure` diagnostic with a
 * machine-readable `reason`:
 * - `outside-onboarding`: a step must be a child of the root `Onboarding`;
 * - `onboarding-not-root`: an Onboarding is the root;
 * - `not-a-step`: only step widgets go in `steps`;
 * - `at-most-one-induction`: the booking is one widget's State, so a wizard has at most one induction step;
 * - `start-step-out-of-range`: `startStep` names a step that exists.
 */

import type { BlueprintCompileView } from '@deviltea/widget-core'
import { isStepType } from '../domain'

type NodeView = Parameters<BlueprintCompileView['getParent']>[0]

export interface StructureContext {
	readonly widget: NodeView
	readonly blueprint: BlueprintCompileView
	readonly addDiagnostic: (diagnostic: { readonly message: string, readonly reason?: string }) => void
}

/** A step must sit directly under an `Onboarding` (`type` names the widget for the message). */
export function checkInsideOnboarding({ widget, blueprint, addDiagnostic }: StructureContext, type: string): void {
	const parent = blueprint.getParent(widget)
	if (parent === null || (parent.resolved && parent.type !== 'Onboarding'))
		addDiagnostic({ message: `A ${type} must be placed in the steps of an Onboarding.`, reason: 'outside-onboarding' })
}

/** The ids and types of the steps of the root Onboarding, in order; a child that is not a step, or whose id is shared, is skipped. */
export function stepChildren(blueprint: Pick<BlueprintCompileView, 'root' | 'getChildrenAt' | 'getWidget'>): readonly { readonly id: string, readonly type: string }[] {
	const root = blueprint.root
	if (!root.resolved || root.type !== 'Onboarding')
		return []
	return blueprint.getChildrenAt(root, 'steps')
		.flatMap(child => child.resolved && isStepType(child.type) && blueprint.getWidget(child.id) !== null ? [{ id: child.id, type: child.type }] : [])
}

/**
 * `stepChildren` for the Blueprint views a callback or a Runtime hands out at run time. They have the same navigation
 * methods as the compile view; only their static node types differ, so the view is read through the compile view's type.
 */
export function stepChildrenOfView(view: unknown): readonly { readonly id: string, readonly type: string }[] {
	return stepChildren(view as BlueprintCompileView)
}
