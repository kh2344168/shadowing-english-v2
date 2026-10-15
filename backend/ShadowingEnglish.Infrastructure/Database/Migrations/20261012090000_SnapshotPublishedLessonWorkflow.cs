using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Infrastructure.Database;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261012090000_SnapshotPublishedLessonWorkflow")]
public partial class SnapshotPublishedLessonWorkflow : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "WorkflowStagesJson", table: "PublishedLessonSlots", type: "nvarchar(max)",
            maxLength: 16000, nullable: true);
        // Best-effort snapshot for versions published before this column existed.
        // A null value remains the legacy lesson flow, never a live workflow lookup.
        migrationBuilder.Sql("""
            UPDATE slot SET WorkflowStagesJson = workflow.StagesJson
            FROM PublishedLessonSlots AS slot
            INNER JOIN LessonWorkflows AS workflow ON workflow.LessonVersionId = slot.LessonVersionId
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "WorkflowStagesJson", table: "PublishedLessonSlots");
}
