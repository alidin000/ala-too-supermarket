"""Category tree helpers.

A small supermarket has tens of categories, so the whole tree is loaded with one query and
walked in Python. A category is *effectively active* only when it and every ancestor are
active; categories caught in a parent cycle are never reachable and count as inactive.
"""

from dataclasses import dataclass, field

from .models import Category


@dataclass
class CategoryTree:
    parents: dict[int, int | None] = field(default_factory=dict)
    slugs: dict[str, int] = field(default_factory=dict)
    children: dict[int | None, list[int]] = field(default_factory=dict)
    active: set[int] = field(default_factory=set)

    def descendants(self, category_id: int) -> set[int]:
        """The category itself plus all effectively active descendants."""
        if category_id not in self.active:
            return set()
        found = {category_id}
        stack = [category_id]
        while stack:
            for child in self.children.get(stack.pop(), []):
                if child in self.active and child not in found:
                    found.add(child)
                    stack.append(child)
        return found

    def active_id_for_slug(self, slug: str) -> int | None:
        category_id = self.slugs.get(slug)
        return category_id if category_id in self.active else None


def load_category_tree() -> CategoryTree:
    tree = CategoryTree()
    is_active: dict[int, bool] = {}
    for row in Category.objects.values("id", "parent_id", "slug", "is_active"):
        tree.parents[row["id"]] = row["parent_id"]
        tree.slugs[row["slug"]] = row["id"]
        tree.children.setdefault(row["parent_id"], []).append(row["id"])
        is_active[row["id"]] = row["is_active"]
    stack = [root for root in tree.children.get(None, []) if is_active[root]]
    while stack:
        node = stack.pop()
        if node in tree.active:
            continue
        tree.active.add(node)
        stack.extend(child for child in tree.children.get(node, []) if is_active[child])
    return tree
