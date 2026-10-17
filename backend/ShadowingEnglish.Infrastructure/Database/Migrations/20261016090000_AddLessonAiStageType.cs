using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Infrastructure.Database;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261016090000_AddLessonAiStageType")]
public partial class AddLessonAiStageType : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("StageType", "LessonAiContents", type: "nvarchar(32)",
            maxLength: 32, nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn("StageType", "LessonAiContents");
    }
}
